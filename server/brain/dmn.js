// Default mode network — Reflection Engine. While "resting", it integrates
// many episodes into higher-level insights and reviews skill promotion.
import { addEpisode } from './neocortex.js';
import { considerPromotion, skillName } from './cerebellum.js';
import { actionLabel } from '../agents.js';
import { truncate } from '../text.js';

function heuristicInsights(B, t, customerId) {
  const out = [];
  const wm = B.state.working[customerId];
  const journey = (wm?.journey || []).map((j) => B.agentDomain(j.agentId));
  for (let i = 1; i < journey.length; i++) {
    if (journey[i - 1] === 'repair' && journey[i] === 'travel') {
      out.push(t.L(
        'Khi xe/thiết bị gặp sự cố, khách thường chuyển sang nhu cầu di chuyển → nên chủ động đề xuất phương án thay thế.',
        'When a car/device breaks down, the customer soon needs transport → proactively offer a replacement option.',
        '車やデバイスが故障すると、お客様はすぐ移動手段を必要とする → 代替手段を先回りして提案する。'
      ));
      break;
    }
  }
  const records = Object.values(B.state.traces).filter((r) => r.customerId === customerId);
  const accepted = records.flatMap((r) => r.feedback || []).filter((f) => f.accepted);
  if (accepted.length >= 2) {
    const counts = accepted.reduce((m, f) => ((m[f.actionId] = (m[f.actionId] || 0) + 1), m), {});
    const [id, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const label = actionLabel(id, t.lang);
    out.push(t.L(`Khách hay chấp nhận gợi ý "${label}" (${n} lần) → ưu tiên trong các lần sau.`, `The customer often accepts "${label}" (${n} times) → prioritize it next time.`, `お客様は「${label}」をよく承諾する（${n}回）→ 次回も優先する。`));
  }
  const salient = B.state.episodes.filter((e) => e.customerId === customerId && e.kind === 'salient').length;
  if (salient >= 2) {
    out.push(t.L(
      `Khách có ${salient} khoảnh khắc căng thẳng gần đây → giao tiếp đồng cảm, xử lý nhanh, cân nhắc escalation sớm.`,
      `${salient} stressful moments recently → be empathetic, act fast, consider early escalation.`,
      `最近ストレスの高い場面が${salient}回 → 共感を示し、迅速に対応し、早めのエスカレーションを検討。`
    ));
  }
  return out;
}

export async function reflect(B, t, { customerId }) {
  // Insights are shared, so private episodes (e.g. Health) never feed reflection.
  const eps = B.state.episodes.filter((e) => e.customerId === customerId && e.kind !== 'insight' && e.scope !== 'private');
  let insights = null;
  if (eps.length >= 2) {
    insights = await B.llm.reflect(eps.slice(-15).map((e) => `- ${e.text}`).join('\n'), t.lang);
  }
  if (!insights) insights = heuristicInsights(B, t, customerId);

  const existing = new Set(B.state.episodes.filter((e) => e.kind === 'insight' && e.customerId === customerId).map((e) => e.text));
  const added = [];
  for (const text of insights.slice(0, 3)) {
    const full = `[Insight] ${text}`;
    if (existing.has(full)) continue;
    added.push(addEpisode(B, { customerId, agentId: 'dmn', ownerDomain: 'system', scope: 'shared', kind: 'insight', text: full, importance: 0.85 }));
    B.state.insights.push({ customerId, text, at: B.clock.now() });
  }
  t.step('dmn', t.L(`Phản tư: ${added.length} insight mới từ ${eps.length} episode`, `Reflection: ${added.length} new insights from ${eps.length} episodes`, `内省：${eps.length}件のエピソードから新しい洞察を${added.length}件`), {
    episodesReviewed: eps.length,
    insights: added.map((e) => truncate(e.text, 140)),
    engine: B.llm.available ? 'LLM' : 'heuristic',
  }, { from: 'neocortex' });

  // Skill promotion review (batch) — catches patterns that matured offline.
  const promoted = [];
  for (const p of Object.values(B.state.patterns)) {
    const s = considerPromotion(B, p);
    if (s) promoted.push(s);
  }
  const deprecated = [];
  for (const s of B.state.skills) {
    const p = B.state.patterns[`${s.domain}|${s.intent}`];
    if (s.status === 'active' && p && p.failures > p.successes.length + 2) {
      s.status = 'deprecated';
      deprecated.push(skillName(s, t.lang));
    }
  }
  t.step('cerebellum', t.L(`Rà soát skill: ${promoted.length} promote, ${deprecated.length} deprecate`, `Skill review: ${promoted.length} promoted, ${deprecated.length} deprecated`, `スキル見直し：昇格${promoted.length}件、廃止${deprecated.length}件`), {
    promoted: promoted.map((s) => `${skillName(s, t.lang)} v${s.version}`),
    deprecated,
    totalSkills: B.state.skills.length,
  }, { from: 'dmn', status: promoted.length ? 'hit' : 'ok' });
  return { insights: added, promoted, deprecated };
}
