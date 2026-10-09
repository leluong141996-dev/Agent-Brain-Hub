// v0.6: an entity graph — recognition fixes, entity resolution, multi-hop
// retrieval by spreading activation over permitted candidates only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { extractFactsRuleBased } from '../server/brain/ontology.js';
import { detectIntent } from '../server/brain/prefrontal.js';

const makeBrain = (store = new Store(null)) => new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const rels = (s) => extractFactsRuleBased(s).map((f) => `${f.relation}=${f.value}`);

test('graph/A: "flying to X" and friends are trips; "airport" means ground transport', (t) => {
  assert.deepEqual(rels("I'm flying to Da Nang tomorrow"), ['trip_destination=Da Nang']);
  assert.deepEqual(rels("I'm travelling to Tokyo next week"), ['trip_destination=Tokyo']);
  assert.deepEqual(rels('We are heading to Hue on Friday'), ['trip_destination=Hue']);
  const mia = { domain: 'personal' };
  assert.equal(detectIntent('How will I get to the airport tomorrow?', mia).intent, 'ground_transport');
});

test('graph/B: entity resolution within a customer (vi / en / ja, brands and models)', async () => {
  const { entityOf } = await import('../server/brain/entities.js');
  const e = (relation, value) => entityOf({ relation, value });
  assert.equal(e('owns_asset', 'Honda Civic'), 'asset:car');
  assert.equal(e('asset_unavailable', 'no car for 3 days'), 'asset:car');
  assert.equal(e('asset_unavailable', 'không có xe 3 ngày'), 'asset:car');
  assert.equal(e('asset_unavailable', '車が3日間使えない'), 'asset:car');
  assert.equal(e('owns_asset', 'Dell XPS 13 laptop'), 'asset:laptop');
  assert.equal(e('owns_asset', 'iPhone 15 Pro'), 'asset:phone');
  assert.equal(e('trip_destination', 'Da Nang'), 'trip:da-nang');
  assert.equal(e('trip_destination', 'Đà Nẵng'), 'trip:da-nang', 'the same city in Vietnamese');
  assert.equal(e('diet', 'vegetarian'), 'self');
  assert.equal(e('allergic_to', 'peanuts'), 'health');
  assert.equal(e('budget', '800 USD'), 'finance');
  assert.equal(e('policy', 'x'), 'org');
});

test('graph/B: "my Civic" reaches the car that is in the shop, marked "via"', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'My car is a Honda Civic', lang: 'en' });
  await b.think({ agentId: 'kai', text: 'The car broke down, it will be in the shop for 3 days', lang: 'en' });
  const r = await b.recall({ agentId: 'penny', text: 'Should I set money aside for my Civic this week?', lang: 'en' });
  const car = r.memories.find((m) => /no car for 3 days/.test(m.text));
  assert.ok(car, r.memories.map((m) => m.text).join(' | '));
  assert.match(car.via || '', /Civic/);
  assert.match(r.promptBlock, /no car for 3 days \(.*via: Honda Civic\)/);
});

test('graph/B: expansion never reaches private or expired facts', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'sage', text: 'I am allergic to peanuts', lang: 'en' });
  await b.think({ agentId: 'atlas', text: "I'm flying to Tokyo next week", lang: 'en' });
  const r = await b.recall({ agentId: 'atlas', text: 'Book a meal for my Tokyo trip', lang: 'en' });
  assert.ok(!/peanut/i.test(r.promptBlock), 'private allergy stays private even though trip ↔ allergy is an edge');

  await b.think({ agentId: 'kai', text: 'My car broke down, it will be in the shop for 3 days', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'My car is a Honda Civic', lang: 'en' });
  b.advanceClock(10);
  const later = await b.recall({ agentId: 'penny', text: 'Should I set money aside for my Civic this week?', lang: 'en' });
  assert.ok(!later.memories.some((m) => /no car for 3 days/.test(m.text)), 'the expired fact is not pulled in');
});

test('graph/B: the customer profile is not a hub that drags everything in', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'My name is Linh and I live in Hanoi. I am vegetarian. I love jazz.', lang: 'en' });
  const r = await b.recall({ agentId: 'kai', text: 'My laptop screen is cracked', lang: 'en' });
  assert.ok(!r.memories.some((m) => m.via && /jazz|vegetarian|Hanoi/.test(m.text)), r.memories.map((m) => `${m.text} via ${m.via}`).join(' | '));
});
