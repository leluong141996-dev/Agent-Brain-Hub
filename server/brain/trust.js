// Agent trust (v0.7): how often an agent's facts hold up. A Beta(α, β) score
// starting at 0.5, learned from humans resolving conflicts, undone automatic
// decisions, and other agents confirming the same value.
const PRIOR = 2;

export function trustOf(B, agentId) {
  const t = B.state.trust?.[agentId];
  const a = PRIOR + (t?.up || 0);
  const b = PRIOR + (t?.down || 0);
  return a / (a + b);
}

function bump(B, agentId, key) {
  if (!agentId) return;
  const t = ((B.state.trust ||= {})[agentId] ||= { up: 0, down: 0 });
  t[key] += 1;
}

export const reward = (B, agentId) => bump(B, agentId, 'up');
export const penalize = (B, agentId) => bump(B, agentId, 'down');

export function trustView(B, agentId) {
  const t = B.state.trust?.[agentId] || { up: 0, down: 0 };
  return { score: +trustOf(B, agentId).toFixed(2), up: t.up, down: t.down };
}
