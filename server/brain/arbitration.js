// Arbitration (v0.7): when two values of a relation clash, the relation's
// policy decides: latest | owner | trust | human. Pure: it returns a decision
// and writeFact applies it. The same agent on both sides means the customer
// contradicted themselves, so owner and trust leave it to a human.
import { trustOf } from './trust.js';

export const TRUST_MARGIN = 0.15;

export function arbitrate(B, { rel, agent, old }) {
  const policy = rel.policy || 'trust';
  const oldAgent = old.sourceAgentId;
  if (policy === 'latest') return { winner: 'new', policy };
  if (policy === 'human') return { winner: null, policy, reason: 'policy_human' };
  if (oldAgent === agent.id) return { winner: null, policy, reason: 'same_agent' };
  if (policy === 'owner') {
    const newOwner = agent.domain === rel.owner;
    const oldOwner = B.agentDomain(oldAgent) === rel.owner;
    if (newOwner !== oldOwner) return { winner: newOwner ? 'new' : 'old', policy };
    return { winner: null, policy, reason: 'no_single_owner' };
  }
  const tn = trustOf(B, agent.id);
  const to = trustOf(B, oldAgent);
  const trust = { new: +tn.toFixed(2), old: +to.toFixed(2) };
  if (Math.abs(tn - to) >= TRUST_MARGIN) return { winner: tn > to ? 'new' : 'old', policy, trust };
  return { winner: null, policy, reason: 'trust_tie', trust };
}
