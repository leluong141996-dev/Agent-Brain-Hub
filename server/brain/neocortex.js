// Neocortex — Persistent Memory Layer (episodic + semantic stores) with
// hot/warm/cold tiering, multi-agent scoping and contradiction resolution.
import { RELATIONS, validateFact, factToText, factEmbedText, sameValue } from './ontology.js';
import { visibleAt, invalidate, markConflict } from './temporal.js';
import { similarity } from '../text.js';
import { embed } from '../embed.js';
import { DAY } from '../clock.js';

// Human-readable reasons for writeFact outcomes.
export const WRITE_REASONS = {
  negation: { vi: 'phủ định fact đang active', en: 'negates an active fact', ja: '有効な事実を否定' },
  close_values: { vi: 'giá trị gần nhau → giữ bản mới', en: 'close values → keep the newer one', ja: '近い値 → 新しい方を保持' },
  customer_update: { vi: 'khách báo thay đổi', en: 'customer reported a change', ja: 'お客様が変更を申告' },
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

// Write a fact through ontology validation, single-writer ownership and
// contradiction resolution. Returns { action, fact, against? , reason? }.
export function writeFact(B, input, { agent, customerId }) {
  const err = validateFact(input, RELATIONS[input.relation] && { entity: RELATIONS[input.relation].entity });
  if (err) return { action: 'rejected', reason: err, input };
  const rel = RELATIONS[input.relation];
  const now = B.clock.now();
  const ttlDays = input.ttlDays ?? rel.ttlDays;
  const ownerDomain = rel.writer;
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
    (f) => f.customerId === customerId && f.entity === input.entity && visibleAt(f, now)
  );

  // Negation against the opposite relation ("thích X" vs "không thích X").
  if (rel.opposite) {
    const neg = live.find((f) => f.relation === rel.opposite && sameValue(f.value, input.value));
    if (neg) {
      if (input.isUpdate) {
        const f = make();
        invalidate(neg, { by: f.id, reason: 'superseded', at: now });
        return { action: 'superseded', fact: f, against: neg, delegated };
      }
      const f = make();
      markConflict(f, neg, now);
      return { action: 'conflict', fact: f, against: neg, reason: 'negation', delegated };
    }
  }

  const same = live.filter((f) => f.relation === input.relation);
  const dup = same.find((f) => sameValue(f.value, input.value));
  if (dup) {
    dup.confidence = Math.min(1, dup.confidence + 0.1);
    dup.updatedAt = now;
    if (ttlDays) dup.validUntil = now + ttlDays * DAY;
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
    const f = make();
    markConflict(f, old, now);
    return { action: 'conflict', fact: f, against: old, reason: 'two_active', delegated };
  }
  return { action: 'created', fact: make(), delegated };
}

export function resolveConflict(B, factId) {
  const keep = B.state.facts.find((f) => f.id === factId);
  if (!keep) return null;
  const other = B.state.facts.find((f) => f.id === keep.conflictWith);
  const now = B.clock.now();
  keep.status = 'active';
  keep.confidence = 0.95;
  keep.conflictResolvedAt = now;
  delete keep.conflictWith;
  if (other) {
    invalidate(other, { by: keep.id, reason: 'resolved', at: now });
    delete other.conflictWith;
  }
  return keep;
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
