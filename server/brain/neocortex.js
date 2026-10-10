// Neocortex — Persistent Memory Layer (episodic + semantic stores) with
// hot/warm/cold tiering, multi-agent scoping and contradiction resolution.
import { validateFact, factToText, factEmbedText, sameValue } from './ontology.js';
import { ensureRelation, relationOf } from './registry.js';
import { arbitrate } from './arbitration.js';
import { reward, penalize } from './trust.js';
import { audit } from './audit.js';
import { visibleAt, invalidate, markConflict } from './temporal.js';
import { similarity } from '../text.js';
import { embed } from '../embed.js';
import { DAY } from '../clock.js';

// Human-readable reasons for writeFact outcomes.
export const WRITE_REASONS = {
  negation: { vi: 'phủ định fact đang active', en: 'negates an active fact', ja: '有効な事実を否定' },
  close_values: { vi: 'giá trị gần nhau → giữ bản mới', en: 'close values → keep the newer one', ja: '近い値 → 新しい方を保持' },
  customer_update: { vi: 'khách báo thay đổi', en: 'customer reported a change', ja: 'お客様が変更を申告' },
  policy_latest: { vi: 'quy tắc "mới nhất" → giữ giá trị mới', en: 'policy "latest" → keep the newer value', ja: 'ルール「最新」→ 新しい値を採用' },
  policy_owner: { vi: 'quy tắc "chủ sở hữu" → giữ giá trị của miền sở hữu', en: 'policy "owner" → keep the owner domain\'s value', ja: 'ルール「所有者」→ 所有ドメインの値を採用' },
  policy_trust: { vi: 'quy tắc "tin cậy" → giữ giá trị của agent đáng tin hơn', en: 'policy "trust" → keep the more trusted agent\'s value', ja: 'ルール「信頼度」→ 信頼度の高いエージェントの値を採用' },
  two_active: { vi: 'hai giá trị khác nhau cùng active', en: 'two different values active at once', ja: '異なる値が同時に有効' },
};

// Who may read an item.
//  global  → everyone
//  shared  → every agent allowed to read the shared pool (permissions.readShared),
//            plus the agent that wrote it
//  private → only agents of the owner domain
export function visible(item, agent) {
  if (item.scope === 'global') return true;
  const source = item.sourceAgentId || item.agentId;
  if (item.scope === 'shared') return agent.permissions?.readShared !== false || source === agent.id;
  return item.ownerDomain === agent.domain;
}

// Why an item is hidden from an agent (for the retrieval panel and audit).
export function hiddenReason(item, agent) {
  if (item.scope === 'shared') return 'no_shared_access';
  return 'private';
}

export function episodeTier(B, ep, recentIds) {
  if (recentIds.has(ep.id)) return 'hot';
  return B.clock.daysSince(ep.createdAt) <= 30 ? 'warm' : 'cold';
}

export function addEpisode(B, ep) {
  const now = B.clock.now();
  const e = {
    id: B.store.id('ep'),
    kind: 'turn',
    importance: 0.5,
    accessCount: 0,
    createdAt: now,
    lastAccess: now,
    embedding: embed(ep.text),
    ...ep,
  };
  B.state.episodes.push(e);
  B.embedQueue?.kick(); // model vector is added in the background
  return e;
}

const MAX_DECISIONS = 500;

function recordDecision(B, d) {
  const rec = { id: B.store.id('dec'), ...d, at: B.clock.now(), undoneAt: null };
  const list = (B.state.decisions ||= []);
  list.push(rec);
  if (list.length > MAX_DECISIONS) list.splice(0, list.length - MAX_DECISIONS);
  audit(B, { op: 'arbitrate', agentId: d.agentId, customerId: d.customerId, relation: d.relation, itemId: d.winnerId, kind: d.policy });
  return rec;
}

// Write a fact through ontology validation, single-writer ownership and
// contradiction resolution. Returns { action, fact, against? , reason? }.
export function writeFact(B, input, { agent, customerId }) {
  const value = String(input.value ?? '').trim();
  if (!value || value.length > 160) return { action: 'rejected', reason: 'empty or too long value', input };
  const reg = ensureRelation(B, input.relation, { agent, customerId, value, label: input.label || null });
  if (reg.error) return { action: 'rejected', reason: reg.error, input };
  const rel = reg.rel;
  input = { ...input, relation: reg.name, entity: input.entity || rel.entity };
  const err = validateFact(input, rel);
  if (err) return { action: 'rejected', reason: err, input };
  const now = B.clock.now();
  const ttlDays = input.ttlDays ?? rel.ttlDays;
  // A provisional relation is private to each domain that writes it: another
  // domain's write is its own value, never mixed with (or outvoting) the first.
  const ownerDomain = rel.status === 'provisional' ? agent.domain : rel.owner;
  const delegated = agent.domain !== ownerDomain && ownerDomain !== 'system';
  const make = (extra = {}) => {
    const f = {
      id: B.store.id('fact'),
      customerId,
      entity: input.entity,
      relation: input.relation,
      value: String(input.value).trim(),
      valueI18n: input.valueI18n || null,
      scope: rel.scope,
      ownerDomain,
      sourceAgentId: agent.id,
      confidence: 0.7,
      status: 'active',
      pinned: false,
      createdAt: now,
      updatedAt: now,
      recordedAt: now,
      validFrom: now,
      validUntil: ttlDays ? now + ttlDays * DAY : null,
      evidence: input.evidence || null,
      ...extra,
    };
    f.text = factToText(f, 'vi');
    f.embedding = embed(factEmbedText(f));
    B.state.facts.push(f);
    B.embedQueue?.kick();
    return f;
  };
  const live = B.state.facts.filter(
    // Live = believed now; an expired fact is history, not a competitor.
    (f) => f.customerId === customerId && f.entity === input.entity && visibleAt(f, now) && (rel.status !== 'provisional' || f.relation !== input.relation || f.ownerDomain === ownerDomain)
  );

  // Two different values: the relation's policy decides (arbitration.js).
  const clash = (olds, conflictReason) => {
    const old = olds[olds.length - 1];
    const d = arbitrate(B, { rel, agent, old });
    const f = make();
    const base = { customerId, relation: input.relation, policy: d.policy, agentId: agent.id };
    if (d.winner === 'new') {
      for (const o of olds) invalidate(o, { by: f.id, reason: 'outvoted', at: now });
      const decision = recordDecision(B, { ...base, winnerId: f.id, loserId: old.id, loserIds: olds.map((o) => o.id) });
      return { action: 'arbitrated', fact: f, against: old, reason: `policy_${d.policy}`, decision, delegated };
    }
    if (d.winner === 'old') {
      invalidate(f, { by: old.id, reason: 'outvoted', at: now });
      const decision = recordDecision(B, { ...base, winnerId: old.id, loserId: f.id, loserIds: [f.id] });
      return { action: 'outvoted', fact: f, against: old, reason: `policy_${d.policy}`, decision, delegated };
    }
    markConflict(f, old, now);
    return { action: 'conflict', fact: f, against: old, reason: conflictReason, delegated };
  };

  // Negation against the opposite relation ("thích X" vs "không thích X").
  if (rel.opposite) {
    const neg = live.find((f) => f.relation === rel.opposite && sameValue(f.value, input.value));
    if (neg) {
      if (input.isUpdate) {
        const f = make();
        invalidate(neg, { by: f.id, reason: 'superseded', at: now });
        return { action: 'superseded', fact: f, against: neg, delegated };
      }
      return clash([neg], 'negation');
    }
  }

  const same = live.filter((f) => f.relation === input.relation);
  const dup = same.find((f) => sameValue(f.value, input.value));
  if (dup) {
    dup.confidence = Math.min(1, dup.confidence + 0.1);
    dup.updatedAt = now;
    if (ttlDays) dup.validUntil = now + ttlDays * DAY;
    if (dup.sourceAgentId && dup.sourceAgentId !== agent.id && !(dup.confirmedBy ||= []).includes(agent.id)) {
      dup.confirmedBy.push(agent.id);
      reward(B, dup.sourceAgentId);
    }
    return { action: 'reinforced', fact: dup, delegated };
  }
  if (rel.card === 'one' && same.length) {
    const old = same[same.length - 1];
    const close = similarity(old.value, input.value) >= 0.75;
    if (close || input.isUpdate) {
      const f = make();
      for (const o of same) invalidate(o, { by: f.id, reason: 'superseded', at: now });
      return { action: 'superseded', fact: f, against: old, reason: close ? 'close_values' : 'customer_update', delegated };
    }
    return clash(same, 'two_active');
  }
  return { action: 'created', fact: make(), delegated };
}

export function resolveConflict(B, factId) {
  const keep = B.state.facts.find((f) => f.id === factId);
  if (!keep) return null;
  const now = B.clock.now();
  const partner = B.state.facts.find((f) => f.id === keep.conflictWith);
  // Keeping one value of a single-valued relation settles every other live
  // value of it (3+ clashing values are linked only in pairs).
  const single = relationOf(B, keep.relation)?.card === 'one';
  const losers = B.state.facts.filter(
    (f) => f !== keep && visibleAt(f, now) && (f === partner || (single && f.customerId === keep.customerId && f.relation === keep.relation && f.ownerDomain === keep.ownerDomain))
  );
  keep.status = 'active';
  keep.confidence = 0.95;
  keep.conflictResolvedAt = now;
  delete keep.conflictWith;
  for (const o of losers) {
    invalidate(o, { by: keep.id, reason: 'resolved', at: now });
    delete o.conflictWith;
  }
  const penalized = new Set();
  for (const o of losers) {
    if (o.sourceAgentId === keep.sourceAgentId || penalized.has(o.sourceAgentId)) continue;
    penalized.add(o.sourceAgentId);
    penalize(B, o.sourceAgentId);
  }
  if (penalized.size) reward(B, keep.sourceAgentId);
  return keep;
}

// Undo an automatic decision. The loser's value comes back as a new fact, so
// recall({ asOf }) still shows what the brain believed in between.
export function undoDecision(B, decisionId) {
  const d = (B.state.decisions || []).find((x) => x.id === decisionId);
  if (!d || d.undoneAt) return null;
  const winner = B.state.facts.find((f) => f.id === d.winnerId);
  const losers = (d.loserIds || [d.loserId]).map((id) => B.state.facts.find((f) => f.id === id)).filter(Boolean);
  if (!winner || !losers.length) return null;
  const now = B.clock.now();
  // The winner was replaced since (e.g. the customer updated it): bringing the
  // old losers back would put two values side by side.
  if (!visibleAt(winner, now)) return { stale: true, decision: d };
  // Every outvoted value comes back as a new fact, so recall({ asOf }) still
  // shows what the brain believed in between.
  const back = losers.map((loser) => {
    const f = { ...loser, id: B.store.id('fact'), status: 'active', confidence: 0.95, createdAt: now, updatedAt: now, recordedAt: now, validFrom: now, invalidatedAt: null, invalidReason: null, invalidatedBy: null, supersededBy: null, conflictedAt: null, conflictResolvedAt: null };
    delete f.conflictWith;
    B.state.facts.push(f);
    return f;
  });
  // Several values were live together before (a conflict): they come back as one.
  for (const f of back.slice(0, -1)) if (!sameValue(f.value, back[back.length - 1].value)) markConflict(f, back[back.length - 1], now);
  invalidate(winner, { by: back[back.length - 1].id, reason: 'resolved', at: now });
  d.undoneAt = now;
  penalize(B, winner.sourceAgentId);
  for (const id of new Set(losers.map((l) => l.sourceAgentId))) if (id !== winner.sourceAgentId) reward(B, id);
  return { decision: d, fact: back[back.length - 1] };
}

export const GLOBAL_POLICIES = [
  {
    vi: 'Khách đang chờ sửa xe/thiết bị được giảm 20% khi thuê xe hoặc thiết bị thay thế',
    en: 'Customers waiting on a car/device repair get 20% off a rental or loaner replacement',
    ja: '車・デバイスの修理待ちのお客様は、レンタカー・代替機が20%割引',
  },
  {
    vi: 'Khách VIP được ưu tiên chuyên viên trong 5 phút và miễn phí đổi lịch 1 lần',
    en: 'VIP customers reach a human specialist within 5 minutes and get one free rebooking',
    ja: 'VIPのお客様は5分以内に担当者につながり、予約変更が1回無料',
  },
  {
    vi: 'Dữ liệu sức khoẻ và tài chính không được chia sẻ sang agent khác khi chưa có đồng ý của khách',
    en: 'Health and finance data is never shared with other agents without customer consent',
    ja: '健康・金融データは、お客様の同意なしに他のエージェントへ共有しない',
  },
];

export function seedGlobal(B) {
  if (B.state.facts.some((f) => f.scope === 'global')) return;
  const sys = { id: 'system', domain: 'system' };
  for (const p of GLOBAL_POLICIES) {
    const r = writeFact(B, { entity: 'organization', relation: 'policy', value: p.vi, valueI18n: p }, { agent: sys, customerId: '*' });
    if (r.fact) r.fact.pinned = true;
  }
}
