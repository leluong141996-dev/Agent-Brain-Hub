// RAS — Attention / Retrieval service. Decides what from the Neocortex is
// allowed into "consciousness" (the prompt): permission/scope filter → TTL
// filter → hybrid scoring (similarity + recency + importance) → re-rank →
// token budget. Items hidden by scope are reported as `blocked` for the audit.
import { embed, cosine } from '../embed.js';
import { dot } from '../embeddings.js';
import { DAY } from '../clock.js';
import { stateAt } from './temporal.js';
import { estimateTokens, truncate } from '../text.js';
import { visible, hiddenReason, episodeTier } from './neocortex.js';
import { factToText, factValue } from './ontology.js';

// Relations an intent cares about (entity-based semantic lookup).
const INTENT_RELATIONS = {
  reminder: ['name', 'has_children'],
  family_event: ['has_children', 'prefers', 'dislikes', 'budget'],
  advice: ['occupation', 'lives_in', 'prefers'],
  report_breakdown: ['owns_asset', 'asset_issue', 'asset_unavailable'],
  book_maintenance: ['owns_asset', 'asset_issue'],
  repair_status: ['owns_asset', 'asset_unavailable'],
  book_flight: ['trip_destination', 'prefers_seat', 'asset_unavailable', 'diet', 'lives_in', 'budget'],
  book_hotel: ['trip_destination', 'prefers', 'dislikes', 'has_children', 'budget'],
  ground_transport: ['asset_unavailable', 'trip_destination', 'owns_asset', 'lives_in'],
  book_doctor: ['health_condition', 'allergic_to', 'lives_in'],
  symptom_check: ['health_condition', 'allergic_to'],
  medication: ['health_condition', 'allergic_to'],
  budget_planning: ['income', 'budget', 'has_children', 'payment_method'],
  insurance: ['has_children', 'owns_asset', 'occupation', 'income'],
  payment: ['payment_method', 'budget'],
  buy_product: ['budget', 'clothing_size', 'prefers', 'dislikes', 'payment_method'],
  track_order: ['lives_in'],
  return_refund: ['clothing_size', 'payment_method'],
};
const PROFILE = new Set(['name', 'lives_in', 'prefers', 'dislikes', 'occupation', 'diet']);
// Every agent needs these to address the customer properly.
const ESSENTIAL = new Set(['name']);
const TIER_LATENCY = { hot: '0ms', warm: '100–500ms', cold: '1–5s' };

// qvec: the query embedded by the configured model ({ vec, model, status }), or
// null. Items that have a vector from that model are compared with it; all
// others fall back to the local hashing vectors.
// asOf: retrieve what the brain believed at that time (v0.5). readOnly: don't
// record access (used for asOf and benchmarks, so looking never changes memory).
export function retrieve(B, t, { customerId, agent, query, intent, qvec = null, asOf = null, readOnly = false, budgetTokens = 700, maxEpisodes = 4, maxFacts = 10 }) {
  const t0 = performance.now();
  const now = asOf ?? B.clock.now();
  const lang = t.lang;
  const q = embed(query);
  let byModel = 0;
  // Hybrid (CombSUM): a model vector finds paraphrases but blurs exact tokens
  // (order numbers, model names); the hashing vector matches those. Adding the
  // two lets an item that matches in meaning *and* wording rise above items that
  // are merely on the same topic. The sum is never below either signal, so an
  // item found by meaning alone keeps the score it had.
  const similarity = (x) => {
    const lexical = Math.max(0, cosine(q, x.embedding)); // hashed embeddings can go negative
    if (qvec?.vec && x.vec && x.vecModel === qvec.model) {
      byModel += 1;
      return Math.max(0, dot(qvec.vec, x.vec)) + lexical;
    }
    return lexical;
  };
  const wanted = new Set(INTENT_RELATIONS[intent] || []);
  t.step('ras', t.L('Lập kế hoạch truy vấn', 'Planning the query', '検索プランを作成'), {
    query: truncate(query, 80),
    intent,
    entityRelations: [...wanted],
    budgetTokens,
    order: ['procedural ✓', 'episodic', 'semantic'],
    similarity: qvec?.vec ? qvec.model : qvec?.model ? `hashing — ${qvec.model} ${qvec.status}` : 'hashing',
  });

  const excluded = [];
  const blocked = [];
  const reasonHidden = (item) =>
    hiddenReason(item, agent) === 'private'
      ? t.L(`private của ${item.ownerDomain}`, `private to ${item.ownerDomain}`, `${item.ownerDomain} の非公開データ`)
      : t.L('agent không có quyền đọc shared', 'agent has no shared-read permission', '共有メモリの閲覧権限なし');

  // --- Episodic search ---
  const mine = B.memoryIndex.episodes(customerId);
  const recent = new Set([...mine].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3).map((e) => e.id));
  const epCands = [];
  for (const e of mine) {
    if (!visible(e, agent)) {
      const item = { kind: 'episodic', id: e.id, text: truncate(e.text, 70), reason: reasonHidden(e), source: e.agentId, scope: e.scope };
      excluded.push(item);
      blocked.push(item);
      continue;
    }
    if (e.createdAt > now) continue; // not yet remembered at asOf
    if (e.expiresAt && e.expiresAt < now) {
      excluded.push({ kind: 'episodic', id: e.id, text: truncate(e.text, 70), reason: t.L('hết hạn TTL', 'TTL expired', 'TTL切れ') });
      continue;
    }
    const tier = episodeTier(B, e, recent);
    const sim = similarity(e);
    const recency = Math.exp(-(now - e.createdAt) / DAY / 30);
    const score = 0.6 * sim + 0.25 * recency + 0.15 * e.importance;
    if (tier === 'cold' && sim < 0.3) continue; // cold store only queried on strong match
    epCands.push({ kind: 'episodic', id: e.id, text: e.text, tier, scope: e.scope, owner: e.ownerDomain, source: e.agentId, episodeKind: e.kind, at: e.createdAt, validUntil: e.expiresAt || null, score, parts: { sim, recency, importance: e.importance } });
  }
  t.step('neocortex', t.L(`Episodic: quét ${mine.length} episode`, `Episodic: scanned ${mine.length} episodes`, `エピソード記憶：${mine.length}件を走査`), {
    store: 'episodic (vector)',
    scanned: mine.length,
    candidates: epCands.length,
    byTier: countBy(epCands, 'tier'),
  }, { from: 'ras' });

  // --- Semantic search ---
  const facts = B.memoryIndex.facts(customerId);
  const fCands = [];
  for (const f of facts) {
    const text = factToText(f, lang);
    const state = stateAt(f, now);
    if (state === 'unknown') continue; // learned after asOf
    if (state === 'superseded' || state === 'resolved') {
      excluded.push({ kind: 'semantic', id: f.id, text, reason: state === 'resolved' ? t.L('thua khi giải mâu thuẫn', 'lost a resolved conflict', '矛盾の解決で不採用') : t.L('đã bị thay thế (cold)', 'superseded (cold)', '置き換え済み（cold）') });
      continue;
    }
    if (!visible(f, agent)) {
      const item = { kind: 'semantic', id: f.id, text, relation: f.relation, reason: reasonHidden(f), source: f.sourceAgentId, scope: f.scope };
      excluded.push(item);
      blocked.push(item);
      continue;
    }
    if (state === 'expired') {
      excluded.push({ kind: 'semantic', id: f.id, text, reason: t.L('hết hạn (stale)', 'expired (stale)', '期限切れ（stale）') });
      continue;
    }
    const sim = similarity(f);
    const entityHit = wanted.has(f.relation) ? 0.45 : 0;
    const profile = PROFILE.has(f.relation) ? (ESSENTIAL.has(f.relation) ? 0.35 : 0.15) : 0;
    const global = f.scope === 'global' ? 0.1 : 0;
    const score = 0.5 * sim + entityHit + profile + global + 0.1 * f.confidence;
    fCands.push({ kind: 'semantic', id: f.id, text, relation: f.relation, value: factValue(f, lang), tier: 'warm', scope: f.scope, owner: f.ownerDomain, source: f.sourceAgentId, sourceName: f.sourceAgentId ? B.agentName(f.sourceAgentId) : null, at: f.updatedAt || f.createdAt, validUntil: f.validUntil || null, status: state, score, parts: { sim, entityHit, profile } });
  }
  t.step('neocortex', t.L(`Semantic: tra ${facts.length} fact theo entity/query`, `Semantic: looked up ${facts.length} facts by entity/query`, `意味記憶：${facts.length}件をエンティティ/クエリで検索`), {
    store: 'semantic (facts)',
    scanned: facts.length,
    candidates: fCands.length,
    conflicted: fCands.filter((f) => f.status === 'conflicted').length,
    blocked: blocked.length,
  }, { from: 'ras', status: blocked.length ? 'warn' : 'ok' });

  // --- Re-rank + budget ---
  epCands.sort((a, b) => b.score - a.score);
  fCands.sort((a, b) => b.score - a.score);
  const selected = [];
  let used = 0;
  const take = (c) => {
    const cost = estimateTokens(c.text);
    if (used + cost > budgetTokens) {
      excluded.push({ kind: c.kind, id: c.id, text: truncate(c.text, 70), reason: t.L('vượt token budget', 'over token budget', 'トークン予算超過') });
      return;
    }
    used += cost;
    selected.push({ ...c, score: +c.score.toFixed(3), latency: TIER_LATENCY[c.tier], parts: roundParts(c.parts) });
  };
  const relevant = (c) => c.score >= 0.2 || c.status === 'conflicted';
  fCands.filter(relevant).slice(0, maxFacts).forEach(take);
  epCands.filter((c) => c.score >= 0.25).slice(0, maxEpisodes).forEach(take);
  for (const c of fCands.filter(relevant).slice(maxFacts)) excluded.push({ kind: c.kind, id: c.id, text: c.text, reason: t.L('điểm thấp', 'low score', 'スコア不足') });
  for (const c of fCands.filter((x) => !relevant(x))) excluded.push({ kind: c.kind, id: c.id, text: c.text, reason: t.L('dưới ngưỡng liên quan', 'below relevance threshold', '関連度のしきい値未満') });

  const sel = new Set(selected.map((s) => s.id));
  for (const e of readOnly ? [] : mine) {
    if (sel.has(e.id)) {
      e.accessCount += 1;
      e.lastAccess = now;
    }
  }
  const ms = +(performance.now() - t0).toFixed(1);
  t.step('ras', t.L(`Re-rank: chọn ${selected.length} mẩu ký ức (${used} tokens)`, `Re-rank: picked ${selected.length} memories (${used} tokens)`, `再ランク：記憶を${selected.length}件選択（${used}トークン）`), {
    selected: selected.map((s) => ({ kind: s.kind, tier: s.tier, scope: s.scope, from: s.source, score: s.score, text: truncate(s.text, 90) })),
    excludedCount: excluded.length,
    similarity: qvec?.vec ? `hybrid — ${qvec.model} + hashing: ${byModel} items with a model vector, the rest by hashing only` : 'hashing',
    tokens: used,
    ms,
  });
  return { selected, excluded, blocked, tokens: used, ms };
}

function countBy(arr, key) {
  return arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});
}

function roundParts(p) {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +(+v).toFixed(3)]));
}
