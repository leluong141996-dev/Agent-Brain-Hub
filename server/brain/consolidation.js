// Consolidation (v0.8): during sleep, the hippocampus re-reads each session it
// just stored and extracts durable facts from the whole conversation, which a
// single message often does not show ("I have kids" … "Two of them"). Only with
// an LLM. Facts go through the normal write path as the session's agent, so the
// registry, scopes, arbitration and audit apply; a repeat only reinforces.
import { writeFact } from './neocortex.js';
import { sameValue } from './ontology.js';
import { normalizeName, relationOf } from './registry.js';
import { visibleAt } from './temporal.js';
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
      if (outdated(B, { customerId, relation: f.relation, value: f.value, startedAt: s.startedAt })) continue;
      const r = writeFact(B, { relation: f.relation, value: redact(String(f.value)).text, isUpdate: !!f.isUpdate, evidence: `session ${s.episodeId}`, origin: 'consolidation' }, { agent, customerId });
      results.push(r);
    }
  }
  const learned = results.filter((r) => !['rejected', 'reinforced', 'quarantined'].includes(r.action));
  t.step('hippocampus', t.L(`Gom fact: ${learned.length} fact mới từ ${sessions.length} phiên`, `Consolidation: ${learned.length} new facts from ${sessions.length} sessions`, `事実の統合：${sessions.length}セッションから新しい事実${learned.length}件`), {
    facts: results.map((r) => `${r.action}: ${r.fact ? `${r.fact.relation} = ${r.fact.value}` : r.reason}`),
  }, { from: 'hippocampus' });
  return results;
}

// A session is read after the fact, so its transcript can say something the
// customer has since moved on from. Two cases are skipped: the value is one the
// brain already replaced, corrected or lost (a transcript does not bring back
// what ended), and a single-valued relation already has a different value
// recorded after the session began (the conversation was handled online, and
// the newer statement wins). What only the session knows is still learned.
function outdated(B, { customerId, relation, value, startedAt }) {
  const name = normalizeName(relation);
  const now = B.clock.now();
  const same = B.state.facts.filter((x) => x.customerId === customerId && x.relation === name);
  if (same.some((x) => x.invalidatedAt != null && sameValue(x.value, value))) return true;
  if (relationOf(B, name)?.card !== 'one') return false;
  return same.some((x) => visibleAt(x, now) && !sameValue(x.value, value) && (x.recordedAt ?? x.createdAt) >= (startedAt ?? Infinity));
}
