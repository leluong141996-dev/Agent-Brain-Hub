// Audit trail of the shared brain: who read or wrote which memory, and on
// whose behalf. It powers governance (every cross-agent read is traceable)
// and the company-value metrics (knowledge reuse, leaks blocked, …).
// op: 'read' | 'write' | 'blocked' | 'recall' | 'remember' | 'chat' | 'feedback' | 'handoff' | 'agent-*'
// Stored by the Store: an append-only SQLite table (never truncated), or an
// in-memory ring buffer when running without a database (tests).
export function audit(B, entry) {
  B.store.appendAudit({ at: B.clock.now(), ...entry });
}

// Record what RAS let into (or kept out of) an agent's context.
export function auditRetrieval(B, { agent, customerId, traceId, selected, blocked }) {
  for (const s of selected) {
    audit(B, { op: 'read', agentId: agent.id, customerId, traceId, kind: s.kind, itemId: s.id, relation: s.relation || null, sourceAgentId: s.source || null, scope: s.scope });
  }
  for (const b of blocked) {
    audit(B, { op: 'blocked', agentId: agent.id, customerId, traceId, kind: b.kind, itemId: b.id, relation: b.relation || null, sourceAgentId: b.source || null, scope: b.scope });
  }
}
