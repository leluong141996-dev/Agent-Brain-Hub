// Cerebellum — Agent Playbook / Skill Memory (procedural). Matches learned
// skills by trigger, records task patterns and promotes them into versioned
// skills once the promotion rule is met. Steps are stored as ids and only
// rendered into a language when displayed, so a skill serves both languages.
import { ACTIONS, actionLabel } from '../agents.js';
import { DAY } from '../clock.js';
import { tr } from '../i18n.js';

export const PROMOTION_RULE = { minSuccesses: 3, withinDays: 7 };

const STEP_LABELS = {
  ack_emotion: { vi: 'Xin lỗi & ghi nhận cảm xúc', en: 'Apologize & acknowledge the feeling', ja: 'お詫びし、気持ちを受け止める' },
  restate_issue: { vi: 'Tóm tắt lại vấn đề', en: 'Restate the problem', ja: '問題を言い換えて確認' },
  detect_situation: { vi: 'Nhận diện tình huống', en: 'Recognize the situation', ja: '状況を把握' },
  retrieve_facts: { vi: 'Truy xuất fact liên quan', en: 'Retrieve relevant facts', ja: '関連する事実を取得' },
};

export function labelOf(step, lang = 'vi') {
  if (STEP_LABELS[step]) return tr(STEP_LABELS[step], lang);
  return actionLabel(step, lang);
}

export function skillName(skill, lang = 'vi') {
  return tr(skill.name, lang);
}

export function seedSkills(B) {
  if (B.state.skills.length) return;
  const steps = ['ack_emotion', 'restate_issue', 'apology_voucher', 'escalate_human'];
  B.state.skills.push({
    id: 'skill-escalation',
    name: { vi: 'Xử lý khiếu nại / escalation', en: 'Complaint handling / escalation', ja: '苦情対応・エスカレーション' },
    domain: '*',
    intent: 'complaint',
    scope: 'shared',
    status: 'active',
    version: 1,
    versions: [{ version: 1, steps, at: Date.now() }],
    steps,
    uses: 0,
    origin: 'seeded',
  });
}

export function matchSkill(B, t, { agent, intent }) {
  const skill = B.state.skills.find(
    (s) => s.status === 'active' && s.intent === intent && (s.domain === '*' || s.domain === agent.domain)
  );
  const candidates = B.state.skills.filter((s) => s.status === 'active').length;
  if (skill) skill.uses += 1;
  const pattern = B.state.patterns[`${agent.domain}|${intent}`];
  t.step(
    'cerebellum',
    skill
      ? t.L(`Procedural HIT: "${skillName(skill, 'vi')}" v${skill.version}`, `Procedural HIT: "${skillName(skill, 'en')}" v${skill.version}`, `手続き記憶ヒット：「${skillName(skill, 'ja')}」v${skill.version}`)
      : t.L('Procedural miss → suy luận từ đầu', 'Procedural miss → reason from scratch', '手続き記憶なし → ゼロから推論'),
    {
      checked: candidates,
      trigger: intent,
      hit: skill ? { name: skillName(skill, t.lang), version: skill.version, steps: skill.steps.map((s) => labelOf(s, t.lang)) } : null,
      pattern: pattern ? patternView(pattern) : null,
    },
    { status: skill ? 'hit' : 'ok' }
  );
  return skill || null;
}

// Record the outcome of an executed decision; maybe promote to a skill.
export function recordOutcome(B, t, { agent, intent, actionId, success }) {
  if (!intent || intent === 'general') return null;
  const key = `${agent.domain}|${intent}`;
  const p = (B.state.patterns[key] ||= { key, domain: agent.domain, intent, successes: [], failures: 0, actions: {}, promoted: false });
  const now = B.clock.now();
  if (success) {
    p.successes.push(now);
    p.actions[actionId] = (p.actions[actionId] || 0) + 1;
  } else {
    p.failures += 1;
  }
  const promo = considerPromotion(B, p);
  const n = `${p.successes.length}/${PROMOTION_RULE.minSuccesses}`;
  t.step(
    'cerebellum',
    promo
      ? t.L(`Skill promotion: "${skillName(promo, 'vi')}" v${promo.version}`, `Skill promotion: "${skillName(promo, 'en')}" v${promo.version}`, `スキル昇格：「${skillName(promo, 'ja')}」v${promo.version}`)
      : t.L(`Ghi nhận pattern ${intent}: ${n} lần thành công`, `Pattern ${intent} recorded: ${n} successes`, `パターン ${intent} を記録：成功 ${n}`),
    { pattern: patternView(p), rule: PROMOTION_RULE, promoted: promo ? { name: skillName(promo, t.lang), version: promo.version, steps: promo.steps.map((s) => labelOf(s, t.lang)) } : null },
    { status: promo ? 'hit' : 'ok' }
  );
  return promo;
}

export function considerPromotion(B, p) {
  const now = B.clock.now();
  const recent = p.successes.filter((s) => now - s <= PROMOTION_RULE.withinDays * DAY);
  const steps = Object.entries(p.actions)
    .sort((a, b) => b[1] - a[1])
    .map(([a]) => a)
    .slice(0, 2);
  const toolsAvailable = steps.every((s) => ACTIONS.some((a) => a.id === s));
  const describable = steps.length > 0;
  if (recent.length < PROMOTION_RULE.minSuccesses || !describable || !toolsAvailable) return null;

  const fullSteps = ['detect_situation', 'retrieve_facts', ...steps];
  let skill = B.state.skills.find((s) => s.domain === p.domain && s.intent === p.intent);
  if (skill && JSON.stringify(skill.steps) === JSON.stringify(fullSteps)) return null;
  if (skill) {
    skill.version += 1;
    skill.versions.push({ version: skill.version, steps: fullSteps, at: now });
    skill.steps = fullSteps;
    skill.status = 'active';
  } else {
    skill = {
      id: B.store.id('skill'),
      name: { vi: `Playbook ${p.domain}: ${p.intent}`, en: `Playbook ${p.domain}: ${p.intent}`, ja: `プレイブック ${p.domain}: ${p.intent}` },
      domain: p.domain,
      intent: p.intent,
      scope: 'private',
      status: 'active',
      version: 1,
      versions: [{ version: 1, steps: fullSteps, at: now }],
      steps: fullSteps,
      uses: 0,
      origin: 'promoted',
    };
    B.state.skills.push(skill);
  }
  p.promoted = true;
  return skill;
}

export function rollbackSkill(B, skillId) {
  const s = B.state.skills.find((x) => x.id === skillId);
  if (!s || s.versions.length < 2) return null;
  s.versions.pop();
  const prev = s.versions[s.versions.length - 1];
  s.version = prev.version;
  s.steps = prev.steps;
  return s;
}

function patternView(p) {
  return { intent: p.intent, successes: p.successes.length, failures: p.failures, actions: p.actions, promoted: p.promoted };
}
