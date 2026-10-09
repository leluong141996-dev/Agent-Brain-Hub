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
