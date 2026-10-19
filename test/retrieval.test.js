// Retrieval at scale: the per-customer index and keyword (BM25) relevance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { addEpisode } from '../server/brain/neocortex.js';

const makeBrain = (store = new Store(null)) => new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const ep = (b, customerId, text) => addEpisode(b, { customerId, agentId: 'kai', ownerDomain: 'repair', scope: 'shared', kind: 'session', text });

test('index: follows appended memories, replaced arrays and reset', async () => {
  const b = makeBrain();
  ep(b, 'a', 'one');
  ep(b, 'b', 'two');
  assert.deepEqual(b.memoryIndex.episodes('a').map((e) => e.text), ['one']);
  ep(b, 'a', 'three');
  assert.deepEqual(b.memoryIndex.episodes('a').map((e) => e.text), ['one', 'three'], 'appended incrementally');

  b.state.episodes = b.state.episodes.filter((e) => e.text !== 'one'); // what forgetting does
  assert.deepEqual(b.memoryIndex.episodes('a').map((e) => e.text), ['three'], 'rebuilt after the array is replaced');
  assert.deepEqual(b.memoryIndex.episodes('nobody'), []);

  await b.think({ agentId: 'mia', customerId: 'a', text: 'I am vegetarian', lang: 'en' });
  const facts = b.memoryIndex.facts('a');
  assert.ok(facts.some((f) => f.relation === 'diet'), 'facts written by the brain are indexed');
  assert.ok(facts.some((f) => f.customerId === '*'), 'global policies are included');
  assert.ok(!b.memoryIndex.facts('b').some((f) => f.relation === 'diet'), 'other customers do not see them');

  b.store.reset();
  assert.deepEqual(b.memoryIndex.episodes('a'), [], 'reset replaces the state; the index follows');
});

test('index: retrieval only looks at the customer\'s own memories', async () => {
  const b = makeBrain();
  for (let i = 0; i < 2000; i++) ep(b, `c-${i % 100}`, `Session ${i}: brake check for customer ${i % 100}`);
  const r = await b.recall({ agentId: 'kai', customerId: 'c-7', text: 'brake check', lang: 'en', includeSteps: true });
  const step = r.steps.find((s) => s.region === 'neocortex' && /Episodic/.test(s.label));
  assert.match(step.label, /scanned 20 episodes/, 'only this customer\'s 20 of 2000 episodes are scanned');
  assert.ok(r.memories.some((m) => m.kind === 'episodic'));
  assert.ok(r.memories.every((m) => m.kind !== 'episodic' || /customer 7\b/.test(m.text)), 'no other customer\'s episodes');
});

test('identifiers: a question with an exact order number reaches that order among similar LLM summaries', async () => {
  // Found by the LLM benchmark: LLM session summaries are longer and phrased
  // differently each time, so "48207" was a small part of the lexical score and
  // other order sessions (plus an insight) took the episode slots.
  const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
  const items = ['a blue backpack', 'running shoes', 'a desk lamp', 'a phone case', 'a yoga mat', 'a coffee grinder', 'wireless earbuds', 'a rain jacket', 'a tent', 'a kettle', 'a bike helmet', 'a water bottle'];
  const phrasing = [
    (n, x) => `[Nova] The customer reports that their order ORD-${n} for ${x} has not arrived and wants the delivery status.`,
    (n, x) => `[Nova] The customer is still waiting for ${x} (order ORD-${n}) and is worried about the shipping delay.`,
    (n, x) => `[Nova] The customer needs an update on order ORD-${n}; ${x} has not been delivered yet.`,
  ];
  items.forEach((x, i) => addEpisode(b, { customerId: 'kh-001', agentId: 'nova', ownerDomain: 'shopping', scope: 'shared', kind: 'session', text: phrasing[i % 3](48200 + i, x) }));
  addEpisode(b, { customerId: 'kh-001', agentId: 'system', ownerDomain: 'shopping', scope: 'shared', kind: 'insight', text: '[Insight] Customer may benefit from expedited shipping on delayed orders.' });
  for (const q of ['what is going on with order 48207', 'Has ORD-48207 shipped yet?']) {
    const r = await b.recall({ agentId: 'mia', text: q, lang: 'en' });
    assert.ok(r.memories.some((m) => /ORD-48207/.test(m.text)), `${q}: ${r.memories.map((m) => m.text.slice(0, 60)).join(' | ')}`);
  }
});

test('identifiers: when two sessions name the same order, the newer one ranks first', async () => {
  // A reader asked about adversarial duplicates: "cancelled", then two days later "shipped".
  // Both come back (they are both history), but the older one used to rank slightly ahead.
  const b = makeBrain();
  const add = (text) => addEpisode(b, { customerId: 'kh-001', agentId: 'nova', ownerDomain: 'shopping', scope: 'shared', kind: 'session', text });
  add('[Nova] Customer talked with Nova: My order ORD-48207 was cancelled');
  add('[Nova] Customer talked with Nova: My order ORD-48199 is being packed');
  b.advanceClock(2);
  add('[Nova] Customer talked with Nova: My order ORD-48207 has shipped');
  for (const q of ['Where is order 48207?', 'Has ORD-48207 shipped yet?']) {
    const r = await b.recall({ agentId: 'mia', customerId: 'kh-001', text: q, lang: 'en' });
    const at = (re) => r.memories.findIndex((m) => re.test(m.text));
    assert.ok(at(/has shipped/) >= 0 && at(/was cancelled/) >= 0, `${q}: both are kept as history`);
    assert.ok(at(/has shipped/) < at(/was cancelled/), `${q}: newer first: ${r.memories.map((m) => m.text.slice(-30)).join(' | ')}`);
    assert.ok(at(/ORD-48199/) < 0 || at(/ORD-48199/) > at(/was cancelled/), `${q}: a different order does not outrank it`);
  }
});

test('allergy questions reach the allergy fact (vi / en / ja), and only the health domain sees it', async () => {
  // Found by the LLM benchmark: "Do I have any food allergies?" found nothing. Offline it passed
  // only because the extractive summary repeated "peanuts"; an LLM summary says "peanut allergy".
  for (const [lang, value, ask, want] of [
    ['en', 'peanuts', 'Do I have any food allergies?', /peanuts/],
    ['vi', 'hải sản', 'Tôi có bị dị ứng gì không?', /hải sản/],
    ['ja', 'そば', 'アレルギーはありますか？', /そば/],
  ]) {
    const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
    await b.remember({ agentId: 'sage', facts: [{ relation: 'allergic_to', value }], lang });
    b.advanceClock(2 / 24);
    const r = await b.recall({ agentId: 'sage', text: ask, lang });
    assert.ok(r.memories.some((m) => m.kind === 'semantic' && want.test(m.text)), `${lang}: ${r.memories.map((m) => m.text).join(' | ')}`);
    const other = await b.recall({ agentId: 'atlas', text: ask, lang });
    assert.ok(!want.test(other.promptBlock), `${lang}: another domain must not see it`);
  }
});

test('a question that names a relation reaches its fact (children, size, home), without pulling unrelated ones', async () => {
  // Found by the LLM benchmark: "How many children do I have?" found the children fact only
  // when it happened to be flagged as a conflict. Naming the relation is enough to ask for it.
  const make = () => new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
  const ask = async (facts, q, agent = 'mia') => {
    const b = make();
    await b.remember({ agentId: 'mia', facts, lang: 'en' });
    b.advanceClock(2 / 24);
    return b.recall({ agentId: agent, text: q, lang: 'en' });
  };
  const facts = [{ relation: 'has_children', value: 'two' }, { relation: 'diet', value: 'vegetarian' }, { relation: 'payment_method', value: 'credit card' }];
  const kids = await ask(facts, 'How many children do I have?');
  assert.ok(kids.memories.some((m) => m.kind === 'semantic' && /children: two/.test(m.text)), kids.memories.map((m) => m.text).join(' | '));
  const diet = await ask(facts, 'What is my diet?');
  assert.ok(diet.memories.some((m) => /vegetarian/.test(m.text)));
  // Words every sentence has ("with", "for") must not name a relation: "pays with" is payment_method.
  const other = await ask(facts, 'Can you help me with something for tomorrow?');
  assert.ok(!other.memories.some((m) => /credit card/.test(m.text)), other.memories.map((m) => m.text).join(' | '));
});
