// Memory firewall (v0.8.3). Memory is the one place where text an attacker
// wrote can come back later, in another session and from another agent's mouth
// (OWASP ASI06, "memory poisoning"). Three cheap defences, none of which needs
// an LLM:
//   1. A fact whose value reads like an instruction (override, directive, role
//      marker) is HELD for a person instead of written. Release writes it like
//      any other fact; dismiss drops it (and counts against the agent's trust, but
//      only when the agent itself, not a customer's message, supplied the text).
//   2. An agent whose trust has fallen below TRUST_FLOOR cannot change what
//      another agent wrote: the write is held too.
//   3. Instruction-like sentences are removed from episodes (session summaries)
//      before they can be retrieved.
// It is a filter with known limits (see the ROADMAP), not a guarantee.
// BRAIN_FIREWALL=off turns it off (ablation: `npm run bench -- --no-firewall`).
import { audit } from './audit.js';
import { penalize } from './trust.js';

export const HOLD_RISK = 0.7;
export const TRUST_FLOOR = 0.3;
const MAX_HELD = 200;

export const firewallOn = () => !['0', 'off', 'false', 'no'].includes(String(process.env.BRAIN_FIREWALL ?? '').toLowerCase());

// [reason, risk, pattern]. Directives need a verb AND a dangerous object or
// destination, so "send me a reminder" and "I always book a window seat" pass.
const SEND = '(?:send|transfer|wire|forward|email|upload|post|pay|share|give|leak|reveal|disclose|provide)';
const SECRET = '(?:passwords?|passcodes?|api[- ]?keys?|secrets?|credentials?|tokens?|private keys?|ssn|card numbers?|otp|(?:all |the )?(?:customer|user|personal|client) (?:data|records|details))';
const RULES = [
  ['override', 1, /\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,30}\b(?:previous|prior|above|earlier|preceding|all|any|your|these|the)\b[^.!?\n]{0,20}\b(?:instructions?|rules?|prompts?|polic(?:y|ies)|guidelines?|directives?|restrictions?)\b/i],
  ['override', 1, /\bnew instructions?\s*:|\bfrom now on,? (?:you|the assistant|all agents|every agent)\b/i],
  ['override', 1, /\b(?:you are now|act as|pretend to be)\b[^.!?\n]{0,40}\b(?:unrestricted|no restrictions|without (?:any )?(?:rules|restrictions|limits)|jailbroken|developer mode)\b/i],
  ['override', 1, /(?:bỏ qua|phớt lờ|quên đi|bỏ hết)[^.!?\n]{0,30}(?:hướng dẫn|chỉ dẫn|quy tắc|chỉ thị|lệnh)/i],
  ['override', 1, /(?:指示|ルール|命令|制限)[^。！？\n]{0,8}(?:無視|忘れ)|(?:無視|忘れ)[^。！？\n]{0,6}(?:指示|ルール|命令)/],
  ['role', 0.9, /(?:^|[\n\r.]\s*)(?:system|assistant|developer)\s*:|<\|(?:im_start|im_end|system)\|>|\[\/?INST\]|<<\/?SYS>>/i],
  ['hidden', 0.7, /[​-‏‪-‮⁠⁦-⁩﻿]/],
  ['directive', 0.8, new RegExp(`\\b${SEND}\\b[^.!?\\n]{0,50}\\bto\\s+(?:the\\s+|my\\s+|this\\s+)?(?:bank\\s+)?(?:account|acct|iban|wallet|url|link|website|email address)\\b`, 'i')],
  ['directive', 0.8, new RegExp(`\\b${SEND}\\b[^.!?\\n]{0,60}\\b(?:to\\s+\\S+@\\S+\\.\\S+|to\\s+https?://|${SECRET})`, 'i')],
  ['directive', 0.8, /\b(?:approve|grant|authorize|refund)\b[^.!?\n]{0,25}\b(?:every|all|any)\b|\b(?:approve|grant|authorize|refund)\b[^.!?\n]{0,40}\bwithout\s+(?:verification|verifying|checking|approval|asking|review|confirmation)\b/i],
  ['directive', 0.8, /(?:luôn|hãy|phải)[^.!?\n]{0,12}(?:chuyển|gửi)[^.!?\n]{0,20}(?:tiền|khoản|tài khoản|stk)|(?:duyệt|chấp nhận)[^.!?\n]{0,10}(?:mọi|tất cả)[^.!?\n]{0,20}(?:hoàn tiền|yêu cầu)|(?:tiết lộ|cung cấp|gửi)[^.!?\n]{0,15}(?:mật khẩu|khóa api|mã otp)/i],
  ['directive', 0.8, /(?:常に|必ず|すべて|全て)[^。！？\n]{0,12}(?:送金|振り込|振込)|(?:パスワード|暗証番号|APIキー)[^。！？\n]{0,8}(?:教えて|開示|送って)/],
];

// What a text looks like to the firewall: { risk 0..1, reasons: [...] }.
export function scan(text) {
  const s = String(text ?? '');
  const reasons = [];
  let risk = 0;
  for (const [reason, weight, re] of RULES) {
    if (re.test(s)) {
      if (!reasons.includes(reason)) reasons.push(reason);
      risk = Math.max(risk, weight);
    }
  }
  return { risk, reasons };
}

// Replace the instruction-like sentences of a text, keep the rest.
export function neutralize(text) {
  const reasons = [];
  let changed = false;
  const out = String(text).replace(/[^.!?。！？\n]+[.!?。！？]*\s*/g, (sentence) => {
    const r = scan(sentence);
    if (r.risk < HOLD_RISK) return sentence;
    changed = true;
    for (const x of r.reasons) if (!reasons.includes(x)) reasons.push(x);
    return '[instruction-like text removed] ';
  });
  return { text: changed ? out.trim() : String(text), changed, reasons };
}

// Hold a write for a person. Returns the writeFact result.
export function hold(B, { input, agent, customerId, reasons, risk }) {
  const list = (B.state.quarantine ||= []);
  const rec = { id: B.store.id('hold'), customerId, agentId: agent.id, relation: input.relation, label: input.label || null, value: String(input.value).trim(), input: { relation: input.relation, value: input.value, label: input.label, entity: input.entity, isUpdate: input.isUpdate, evidence: input.evidence, origin: input.origin }, via: input.via === 'agent' ? 'agent' : 'customer', reasons, risk, at: B.clock.now() };
  list.push(rec);
  if (list.length > MAX_HELD) list.splice(0, list.length - MAX_HELD);
  audit(B, { op: 'firewall', agentId: agent.id, customerId, relation: input.relation, itemId: rec.id, kind: `hold: ${reasons.join(', ')}` });
  return { action: 'quarantined', reason: 'firewall', reasons, held: rec, input };
}

const find = (B, id) => (B.state.quarantine || []).find((h) => h.id === id);
const drop = (B, rec) => (B.state.quarantine = B.state.quarantine.filter((h) => h !== rec));
const bad = (message, status) => Object.assign(new Error(message), { status });

export function release(B, id, writeFact) {
  const rec = find(B, id);
  if (!rec) throw bad(`nothing held with id "${id}"`, 404);
  const agent = B.state.agents.find((a) => a.id === rec.agentId);
  if (!agent) throw bad(`agent "${rec.agentId}" no longer exists; dismiss this one`, 409);
  drop(B, rec);
  const r = writeFact(B, { ...rec.input, firewall: 'approved' }, { agent, customerId: rec.customerId });
  audit(B, { op: 'firewall', agentId: rec.agentId, customerId: rec.customerId, relation: rec.relation, itemId: r.fact?.id || rec.id, kind: 'release' });
  return r;
}

export function dismiss(B, id) {
  const rec = find(B, id);
  if (!rec) throw bad(`nothing held with id "${id}"`, 404);
  drop(B, rec);
  // Only an agent that handed the brain the text itself is at fault. A customer can type an
  // instruction to any agent; punishing the agent would let an attacker strip honest agents of trust.
  if (rec.via === 'agent') penalize(B, rec.agentId);
  audit(B, { op: 'firewall', agentId: rec.agentId, customerId: rec.customerId, relation: rec.relation, itemId: rec.id, kind: 'dismiss' });
  return { dismissed: true };
}
