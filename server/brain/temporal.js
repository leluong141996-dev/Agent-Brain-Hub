// Time model for facts (v0.5). The single definition of "what the brain
// believed at time t" — used by retrieval, forgetting, profiles and the UI.
//
//   recordedAt               when the brain learned the fact
//   validFrom / validUntil   when the fact is true in the world (validUntil = TTL)
//   invalidatedAt            when the brain stopped believing it:
//     invalidReason          'superseded' (a newer fact replaced it) | 'resolved' (lost a conflict)
//     invalidatedBy          the fact that replaced it
//   conflictedAt / conflictResolvedAt   while it was flagged as a contradiction
//
// Facts are invalidated, not deleted; forgetting purges them after historyDays.

export const DEFAULT_HISTORY_DAYS = 90;

// 'unknown' | 'active' | 'conflicted' | 'expired' | 'superseded' | 'resolved'
export function stateAt(f, t) {
  if (f.recordedAt != null && f.recordedAt > t) return 'unknown';
  if (f.invalidatedAt != null && f.invalidatedAt <= t) return f.invalidReason || 'superseded';
  if (!f.pinned && f.validUntil && f.validUntil < t) return 'expired';
  if (f.conflictedAt != null && f.conflictedAt <= t && (f.conflictResolvedAt == null || f.conflictResolvedAt > t)) return 'conflicted';
  return 'active';
}

export const visibleAt = (f, t) => {
  const s = stateAt(f, t);
  return s === 'active' || s === 'conflicted';
};

// When an ended fact stopped counting (for purging), or null if it still counts.
export function endedAt(f, now) {
  if (f.pinned) return null;
  if (f.invalidatedAt != null) return f.invalidatedAt;
  if (f.validUntil && f.validUntil < now) return f.validUntil;
  return null;
}

export function invalidate(f, { by = null, reason, at }) {
  f.status = 'superseded'; // kept for older readers; invalidReason has the detail
  f.invalidatedAt = at;
  f.invalidReason = reason;
  f.invalidatedBy = by;
  f.supersededBy = by;
  if (f.conflictedAt != null && f.conflictResolvedAt == null) f.conflictResolvedAt = at;
}

export function markConflict(a, b, at) {
  a.status = b.status = 'conflicted';
  a.conflictWith = b.id;
  b.conflictWith = a.id;
  a.conflictedAt ??= at;
  b.conflictedAt ??= at;
  a.conflictResolvedAt = b.conflictResolvedAt = null;
}

// Older facts (before v0.5) get the new fields from what they have.
export function normalizeFact(f) {
  f.recordedAt ??= f.createdAt;
  f.validFrom ??= f.createdAt;
  if (f.status === 'superseded' && f.invalidatedAt == null) {
    f.invalidatedAt = f.updatedAt ?? f.createdAt;
    f.invalidReason ??= 'superseded';
    f.invalidatedBy ??= f.supersededBy ?? null;
  }
  if (f.status === 'conflicted' && f.conflictedAt == null) f.conflictedAt = f.updatedAt ?? f.createdAt;
  return f;
}
