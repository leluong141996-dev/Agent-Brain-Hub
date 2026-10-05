// Basal ganglia — Next Best Action engine. Rule relevance × Thompson-sampled
// success rate (bandit), boosted by habits (procedural skills) and urgency.
// Learns from accept/reject feedback.
import { ACTIONS } from '../agents.js';
import { tr } from '../i18n.js';

function gammaSample(k) {
  // Marsaglia–Tsang (k ≥ 1); boost for k < 1.
  if (k < 1) return gammaSample(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a, b, deterministic) {
  if (deterministic) return a / (a + b);
  const x = gammaSample(a);
  return x / (x + gammaSample(b));
}

export function arm(B, actionId, intent) {
  return (B.state.bandit[`${actionId}|${intent}`] ||= { alpha: 1, beta: 1 });
}

export function selectActions(B, t, { agent, intent, facts, salience, skill, topK = 2 }) {
  const ctx = { intent, facts, salience, domain: agent.domain };
  const habit = new Set(skill ? skill.steps : []);
  const scored = [];
  for (const a of ACTIONS) {
    if (a.domain !== '*' && a.domain !== agent.domain) continue;
    const relevance = a.when(ctx);
    if (relevance <= 0) continue;
    const st = arm(B, a.id, intent);
    const sample = betaSample(st.alpha, st.beta, B.deterministic);
    const habitBoost = habit.has(a.id) ? 0.35 : 0;
    // Bandit sample shifts the score by ±25%: it explores among comparably
    // relevant actions but cannot make a weakly relevant one beat a strong one.
    const score = relevance * (0.75 + 0.5 * sample) + habitBoost;
    scored.push({
      id: a.id,
      label: tr(a.label, t.lang),
      score: +score.toFixed(3),
      parts: { relevance: +relevance.toFixed(2), banditSample: +sample.toFixed(2), alpha: st.alpha, beta: st.beta, habitBoost },
    });
  }
  scored.sort((x, y) => y.score - x.score);
  const chosen = scored.slice(0, topK);
  t.step('basal_ganglia', chosen.length ? t.L(`Chọn hành động: ${chosen[0].label}`, `Chosen action: ${chosen[0].label}`, `選択した行動：${chosen[0].label}`) : t.L('Không có hành động phù hợp', 'No suitable action', '適切な行動なし'), {
    candidates: scored,
    chosen: chosen.map((c) => c.id),
    policy: 'relevance × (0.75 + 0.5·ThompsonSample(α,β)) + habit',
  });
  return chosen;
}

export function learn(B, { actionId, intent, accepted }) {
  const st = arm(B, actionId, intent);
  if (accepted) st.alpha += 1;
  else st.beta += 1;
  return st;
}
