// A software team on one brain: an architect, a coder and a QA agent share
// what they learn about a project (the "customer" is the repository).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';

const team = () => {
  const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
  const id = (name) => b.createAgent({ name, domain: 'engineering', kind: 'external' }).agent.id;
  return { b, architect: id('Architect'), coder: id('Coder'), qa: id('QA') };
};
const REPO = 'repo:shop-api';

test('engineering: what QA found reaches the coder before it writes the code again', async () => {
  const { b, coder, qa } = team();
  await b.remember({ agentId: qa, customerId: REPO, facts: [{ relation: 'known_pitfall', value: 'parseDate breaks on DST changes; test with Europe/Berlin 2026-03-29 02:30' }], lang: 'en' });
  await b.remember({ agentId: qa, customerId: REPO, facts: [{ relation: 'known_pitfall', value: 'the payments webhook is retried, so handlers must be idempotent' }], lang: 'en' });
  const r = await b.recall({ agentId: coder, customerId: REPO, text: 'Implement parseDate for order timestamps', lang: 'en' });
  assert.ok(r.memories.some((m) => /DST/.test(m.text)), r.memories.map((m) => m.text).join(' | '));
  const pitfalls = b.state.facts.filter((f) => f.customerId === REPO && f.relation === 'known_pitfall' && f.status === 'active');
  assert.equal(pitfalls.length, 2, 'pitfalls are a set: a second one does not replace the first');
  const w = await b.recall({ agentId: coder, customerId: REPO, text: 'Add a handler for the payments webhook', lang: 'en' });
  assert.ok(w.memories.some((m) => /idempotent/.test(m.text)));
});

test('engineering: an architecture decision is shared; another project does not see it', async () => {
  const { b, architect, coder } = team();
  await b.remember({ agentId: architect, customerId: REPO, facts: [{ relation: 'convention', value: 'store every timestamp in UTC; convert only in the UI' }], lang: 'en' });
  const r = await b.recall({ agentId: coder, customerId: REPO, text: 'How should I store the created_at timestamp?', lang: 'en' });
  assert.ok(r.memories.some((m) => /UTC/.test(m.text)));
  const other = await b.recall({ agentId: coder, customerId: 'repo:other', text: 'How should I store the created_at timestamp?', lang: 'en' });
  assert.ok(!other.memories.some((m) => /UTC/.test(m.text)), 'memory is per project');
});

test('engineering: intents are recognised (design / implement / test)', async () => {
  const { b, coder } = team();
  const r = await b.think({ agentId: coder, customerId: REPO, text: 'Please write a unit test for the bug in the cart total', lang: 'en' });
  assert.equal(r.intent.intent, 'review_test');
});
