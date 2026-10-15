// Consolidation (v0.8): during sleep, the hippocampus re-reads each session it
// just stored and extracts durable facts from the whole conversation, which a
// single message often does not show ("I have kids" … "Two of them"). Only with
// an LLM. Facts go through the normal write path as the session's agent, so the
// registry, scopes, arbitration and audit apply; a repeat only reinforces.
import { writeFact } from './neocortex.js';
import { sameValue } from './ontology.js';
import { normalizeName } from './registry.js';
import { redact } from './brainstem.js';

export const MAX_FACTS_PER_SESSION = 10;

export async function factsFromSessions(B, t, { customerId, sessions }) {
  if (!B.llm.available || !sessions.length) return [];
  const results = [];
  for (const s of sessions) {
    const agent = B.state.agents.find((a) => a.id === s.agentId);
    if (!agent || agent.permissions?.write === false) continue;
    const facts = (await B.llm.extractFacts(s.transcript, B.llmRelations(agent))) || [];
    for (const f of facts.slice(0, MAX_FACTS_PER_SESSION)) {
      // A value an agent corrected for this customer stays corrected: the
      // session transcript still says it, but it is known to be wrong.
      const name = normalizeName(f.relation);
      if (B.state.facts.some((x) => x.customerId === customerId && x.relation === name && x.invalidReason === 'corrected' && sameValue(x.value, f.value))) continue;
      const r = writeFact(B, { relation: f.relation, value: redact(String(f.value)).text, isUpdate: !!f.isUpdate, evidence: `session ${s.episodeId}`, origin: 'consolidation' }, { agent, customerId });
      results.push(r);
    }
  }
  const learned = results.filter((r) => r.action !== 'rejected' && r.action !== 'reinforced');
  t.step('hippocampus', t.L(`Gom fact: ${learned.length} fact mới từ ${sessions.length} phiên`, `Consolidation: ${learned.length} new facts from ${sessions.length} sessions`, `事実の統合：${sessions.length}セッションから新しい事実${learned.length}件`), {
    facts: results.map((r) => `${r.action}: ${r.fact ? `${r.fact.relation} = ${r.fact.value}` : r.reason}`),
  }, { from: 'hippocampus' });
  return results;
}
