// v0.7: open schema — relations outside the 19 core ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { relationOf } from '../server/brain/registry.js';

const makeBrain = (llm = new LLM({ offline: true })) => new Brain({ store: new Store(null), bus: new NeuralBus(), llm, deterministic: true });

test('open schema: a connected agent can remember a new relation; it stays private to its domain', async () => {
  const b = makeBrain();
  const r = await b.remember({ agentId: 'kai', facts: [{ relation: 'Loyalty Tier', value: 'gold' }], lang: 'en' });
  assert.ok(r.learned.some((l) => l.action === 'created'), JSON.stringify(r.learned));
  const f = b.state.facts.find((x) => x.relation === 'loyalty_tier');
  assert.equal(f.scope, 'private');
  assert.equal(f.ownerDomain, 'repair');
  assert.equal(relationOf(b, 'loyalty_tier').status, 'provisional');
  const kai = await b.recall({ agentId: 'kai', text: 'What loyalty tier is this customer?', lang: 'en' });
  assert.ok(kai.memories.some((m) => /gold/.test(m.text)), 'the writing domain sees it');
  const atlas = await b.recall({ agentId: 'atlas', text: 'What loyalty tier is this customer?', lang: 'en' });
  assert.ok(!atlas.memories.some((m) => /gold/.test(m.text)) && !/gold/.test(atlas.promptBlock), 'another domain does not');
  const profile = b.profile(b.getAgent('atlas'), 'kh-001', 'en');
  assert.ok(!JSON.stringify(profile).includes('gold'), 'nor in the profile');
});

test('open schema: secret-looking relations are refused and stored nowhere', async () => {
  const b = makeBrain();
  const r = await b.remember({ agentId: 'mia', facts: [{ relation: 'wifi_password', value: 'hunter2' }], lang: 'en' });
  assert.ok(r.learned.some((l) => l.action === 'rejected'));
  assert.ok(!JSON.stringify(b.state).includes('hunter2'));
});

test('open schema: the LLM may propose a new relation; known relations are listed in its prompt', async () => {
  let seen = null;
  // Same stub shape as brain.test.js: an "available" LLM with fixed answers.
  const llm = {
    available: true,
    model: 'stub',
    lastError: null,
    async generate() {
      return { text: 'Noted.', model: 'stub', usage: { input_tokens: 1, output_tokens: 1 } };
    },
    async extractFacts(text, relations) {
      seen = relations;
      return [{ relation: 'favourite_colour', value: 'teal', isUpdate: false }];
    },
    async summarize() {
      return null;
    },
    async reflect() {
      return [];
    },
  };
  const b = makeBrain(llm);
  await b.think({ agentId: 'mia', text: 'teal is the one for me', lang: 'en' });
  assert.ok(seen.some((r) => r.name === 'lives_in'), 'core relations are offered for reuse');
  assert.ok(b.state.facts.some((f) => f.relation === 'favourite_colour' && f.value === 'teal'));
});
