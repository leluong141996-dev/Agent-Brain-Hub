// Brainstem — Safety / Guardrail layer. Runs reflexively on the way in
// (PII redaction, crisis reflex) and on the way out (output compliance).
import { L } from '../i18n.js';

const PII = [
  { type: 'EMAIL', re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { type: 'CARD', re: /\b(?:\d[ -]?){13,16}\b/g },
  { type: 'CCCD', re: /\b\d{12}\b/g },
  { type: 'PHONE', re: /(?:\+84|\+81|\b0)(?:[\s.-]?\d){9,10}\b/g },
];

const CRISIS = ['tự tử', 'muốn chết', 'không muốn sống', 'tự làm hại', 'suicide', 'kill myself', 'end my life', 'hurt myself', '死にたい', '自殺', '消えたい', '生きていたくない'];

export function redact(text) {
  const found = [];
  let out = text;
  for (const { type, re } of PII) {
    out = out.replace(re, (m) => {
      found.push({ type, sample: m.slice(0, 2) + '•••' });
      return `[${type}]`;
    });
  }
  return { text: out, found };
}

export function brainstemIn(B, t, text) {
  const { text: clean, found } = redact(text);
  const low = text.toLowerCase();
  const crisis = CRISIS.some((k) => low.includes(k));
  t.step(
    'brainstem',
    crisis
      ? t.L('Phản xạ an toàn: phát hiện tín hiệu khủng hoảng', 'Safety reflex: crisis signal detected', '安全反射：危機シグナルを検知')
      : found.length
        ? t.L(`Che ${found.length} thông tin PII`, `Redacted ${found.length} PII item(s)`, `個人情報を${found.length}件マスキング`)
        : t.L('Kiểm tra an toàn đầu vào: OK', 'Input safety check: OK', '入力の安全チェック：OK'),
    { redacted: found, crisis, policy: 'PII redaction + crisis reflex' },
    { status: crisis ? 'alert' : found.length ? 'warn' : 'ok' }
  );
  return { text: clean, redactions: found, crisis };
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
