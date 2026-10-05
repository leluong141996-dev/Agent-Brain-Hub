// Synaptic pruning — Forgetting Engine. TTL expiry, removal of superseded
// facts, importance decay and pruning of weak, never-used episodes.
import { DAY } from '../clock.js';

export function forget(B, t) {
  const now = B.clock.now();
  const stats = { expiredFacts: [], prunedSuperseded: 0, expiredEpisodes: 0, prunedWeak: 0, decayed: 0, flaggedConflicts: 0 };

  B.state.facts = B.state.facts.filter((f) => {
    if (f.pinned) return true;
    if (f.validUntil && f.validUntil < now) {
      stats.expiredFacts.push(f.text);
      return false;
    }
    if (f.status === 'superseded' && now - f.updatedAt > 30 * DAY) {
      stats.prunedSuperseded += 1;
      return false;
    }
    if (f.status === 'conflicted') stats.flaggedConflicts += 1;
    return true;
  });

  B.state.episodes = B.state.episodes.filter((e) => {
    if (e.expiresAt && e.expiresAt < now) {
      stats.expiredEpisodes += 1;
      return false;
    }
    const idle = (now - e.lastAccess) / DAY;
    if (idle > 30) {
      e.importance = +(e.importance * 0.9).toFixed(3);
      stats.decayed += 1;
    }
    if (e.importance < 0.15 && e.accessCount === 0 && (now - e.createdAt) / DAY > 60) {
      stats.prunedWeak += 1;
      return false;
    }
    return true;
  });

  t.step('forgetting', t.L('Cắt tỉa synapse: TTL, thay thế, suy giảm', 'Synaptic pruning: TTL, supersession, decay', 'シナプス刈り込み：TTL・置き換え・減衰'), {
    expiredFacts: stats.expiredFacts,
    prunedSuperseded: stats.prunedSuperseded,
    expiredEpisodes: stats.expiredEpisodes,
    decayed: stats.decayed,
    prunedWeak: stats.prunedWeak,
    conflictsAwaitingReview: stats.flaggedConflicts,
  }, { status: stats.expiredFacts.length || stats.expiredEpisodes ? 'warn' : 'ok' });
  return stats;
}
