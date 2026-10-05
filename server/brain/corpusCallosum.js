// Corpus callosum — Cross-Agent Event Bus / Handoff Protocol. Builds a
// relevance-filtered handoff package so the next agent never has to re-ask,
// and carries write delegations to the single owner of a fact.
import { visible } from './neocortex.js';
import { factToText } from './ontology.js';
import { truncate } from '../text.js';
import { turnVisible, taskName } from './prefrontal.js';

export function handoff(B, t, { customerId, fromAgentId, toAgent }) {
  const wm = B.state.working[customerId];
  const from = B.state.agents.find((a) => a.id === fromAgentId) || { id: fromAgentId, name: fromAgentId, domain: 'unknown' };
  const now = B.clock.now();
  const facts = B.state.facts.filter(
    (f) => f.customerId === customerId && f.status === 'active' && (!f.validUntil || f.validUntil > now)
  );
  const passed = facts.filter((f) => visible(f, toAgent));
  const withheld = facts.length - passed.length;
  const lastTurns = (wm?.turns || [])
    .filter((x) => x.agentId === fromAgentId && turnVisible(B, x, toAgent))
    .slice(-2)
    .map((x) => `${x.role === 'user' ? 'Customer' : from.name}: ${truncate(x.text, 120)}`);
  const task = wm?.activeTask && wm.activeTask.agentId === fromAgentId ? wm.activeTask : null;
  const pkg = {
    from: from.name,
    to: toAgent.name,
    activeTask: task ? taskName(task, t.lang) : null,
    lastIntent: wm?.intent || null,
    salience: wm?.salience ? { priority: wm.salience.priority, sentiment: wm.salience.sentiment } : null,
    lastTurns,
    facts: passed.map((f) => factToText(f, t.lang)),
    withheld,
    at: now,
  };
  if (wm) {
    wm.handoffs.push(pkg);
    if (wm.handoffs.length > 10) wm.handoffs.shift();
  }
  B.bus.publish('handoff', { customerId, from: from.name, to: toAgent.name, facts: pkg.facts.length, withheld });
  t.step('corpus_callosum', `Handoff ${from.name} → ${toAgent.name}`, {
    package: pkg,
    filter: t.L(`${passed.length} fact được chuyển, ${withheld} fact private bị giữ lại`, `${passed.length} facts passed, ${withheld} private facts withheld`, `事実${passed.length}件を引き継ぎ、非公開の${withheld}件は保留`),
  });
  return pkg;
}

export function delegateWrite(B, t, { fact, fromAgent }) {
  B.bus.publish('write-delegation', { relation: fact.relation, from: fromAgent.name, owner: fact.ownerDomain });
  t.step('corpus_callosum', t.L(`Uỷ quyền ghi "${fact.relation}" cho owner ${fact.ownerDomain}`, `Delegated write of "${fact.relation}" to owner ${fact.ownerDomain}`, `「${fact.relation}」の書き込みをオーナー ${fact.ownerDomain} に委任`), {
    rule: 'single-writer-per-entity',
    from: fromAgent.name,
    owner: fact.ownerDomain,
    fact: factToText(fact, t.lang),
  }, { from: 'hippocampus' });
}
