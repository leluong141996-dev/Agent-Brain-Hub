// Brainstem — Safety / Guardrail layer. Runs reflexively on the way in
// (PII redaction, crisis reflex) and on the way out (output compliance).
import { L } from '../i18n.js';
import { firewallOn, neutralize } from './firewall.js';

// An IBAN is only an IBAN when its check digits are right (ISO 13616, mod 97).
function validIban(s) {
  const iban = s.replace(/\s/g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

// Order matters: an IBAN contains runs of digits a card pattern would take.
const PII = [
  { type: 'EMAIL', re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { type: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, valid: validIban },
  { type: 'CARD', re: /\b(?:\d[ -]?){13,16}\b/g },
  { type: 'CCCD', re: /\b\d{12}\b/g },
  // US SSN, written with separators (a bare 9-digit number is far too common), never 000 / 666 / 9xx, 00 or 0000.
  { type: 'SSN', re: /\b(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g },
  { type: 'PHONE', re: /(?:\+84|\+81|\b0)(?:[\s.-]?\d){9,10}\b/g },
  // Any other international number: "+", a country code and 6 to 12 more digits (8 to 15 in all).
  { type: 'PHONE', re: /\+[1-9]\d{0,2}(?:[\s.()-]*\d){6,12}(?!\d)/g },
];

const CRISIS = ['tự tử', 'muốn chết', 'không muốn sống', 'tự làm hại', 'suicide', 'kill myself', 'end my life', 'hurt myself', '死にたい', '自殺', '消えたい', '生きていたくない'];

export function redact(text) {
  const found = [];
  let out = text;
  for (const { type, re, valid } of PII) {
    out = out.replace(re, (m) => {
      if (valid && !valid(m)) return m;
      found.push({ type, sample: m.slice(0, 2) + '•••' });
      return `[${type}]`;
    });
  }
  return { text: out, found };
}

export function brainstemIn(B, t, text) {
  const redacted = redact(text);
  const found = redacted.found;
  // Memory firewall: an instruction-like sentence is cut here, once, so that no later stage
  // (the reply, fact extraction, the session summary) ever reads it. A model that never saw the
  // instruction cannot restate it in its own words, which no pattern filter could catch.
  const cut = firewallOn() ? neutralize(redacted.text) : { text: redacted.text, changed: false, reasons: [] };
  const clean = cut.text;
  const low = text.toLowerCase();
  const crisis = CRISIS.some((k) => low.includes(k));
  t.step(
    'brainstem',
    crisis
      ? t.L('Phản xạ an toàn: phát hiện tín hiệu khủng hoảng', 'Safety reflex: crisis signal detected', '安全反射：危機シグナルを検知')
      : cut.changed
        ? t.L('Tường lửa: đã cắt câu giống chỉ dẫn khỏi tin nhắn', 'Firewall: cut an instruction-like sentence from the message', 'ファイアウォール：指示のような文をメッセージから除去')
      : found.length
        ? t.L(`Che ${found.length} thông tin PII`, `Redacted ${found.length} PII item(s)`, `個人情報を${found.length}件マスキング`)
        : t.L('Kiểm tra an toàn đầu vào: OK', 'Input safety check: OK', '入力の安全チェック：OK'),
    { redacted: found, crisis, injection: cut.changed ? cut.reasons : [], policy: 'PII redaction + crisis reflex + instruction firewall' },
    { status: crisis ? 'alert' : found.length || cut.changed ? 'warn' : 'ok' }
  );
  return { text: clean, redactions: found, crisis, injection: cut.reasons };
}

export function brainstemOut(B, t, reply, agent) {
  const { text: clean, found } = redact(reply);
  let out = clean;
  const rules = ['no-PII-leak'];
  if (agent.domain === 'health' && !/bác sĩ|chuyên gia y tế|doctor|medical professional|医師|医療機関/i.test(out)) {
    out += t.L('\n\n_Lưu ý: thông tin chỉ mang tính tham khảo, vui lòng hỏi ý kiến bác sĩ._', '\n\n_Note: for reference only — please consult a doctor._', '\n\n_※参考情報です。必ず医師にご相談ください。_');
    rules.push('health-disclaimer');
  }
  if (agent.domain === 'finance' && !/không phải lời khuyên đầu tư|not investment advice|投資助言ではありません/i.test(out)) {
    out += t.L('\n\n_Lưu ý: đây không phải lời khuyên đầu tư._', '\n\n_Note: this is not investment advice._', '\n\n_※投資助言ではありません。_');
    rules.push('finance-disclaimer');
  }
  t.step('brainstem', t.L('Kiểm duyệt đầu ra', 'Output compliance check', '出力のコンプライアンスチェック'), { redacted: found, rules }, { status: found.length ? 'warn' : 'ok' });
  return out;
}

export function crisisReply(lang) {
  return L(
    lang,
    'Mình rất lo cho bạn. Nếu bạn đang gặp nguy hiểm, hãy gọi ngay 115 hoặc đường dây hỗ trợ tâm lý 1800 599 920 (miễn phí). Mình đã chuyển cuộc trò chuyện tới chuyên viên để hỗ trợ bạn ngay.',
    "I'm really concerned about you. If you are in danger, please call your local emergency number right away or a crisis hotline. I've escalated this conversation to a human specialist who can help you now.",
    'あなたのことがとても心配です。危険を感じている場合は、すぐに119番、または「よりそいホットライン」(0120-279-338) にご連絡ください。この会話は担当スタッフに引き継ぎました。'
  );
}
