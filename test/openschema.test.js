// v0.7: open schema — relations outside the 19 core ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { relationOf } from '../server/brain/registry.js';
import { extractFactsRuleBased, relationLabel } from '../server/brain/ontology.js';

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

const fav = (s) => extractFactsRuleBased(s).filter((f) => f.relation.startsWith('favourite_')).map((f) => `${f.relation}=${f.value}`);

test('open schema offline: "my favourite X is Y" in en / vi / ja', () => {
  assert.deepEqual(fav('My favourite colour is blue'), ['favourite_colour=blue']);
  assert.deepEqual(fav('my favorite color is dark green, by the way'), ['favourite_colour=dark green']);
  assert.deepEqual(fav('Màu yêu thích của tôi là xanh lá'), ['favourite_colour=xanh lá']);
  assert.deepEqual(fav('Món ăn yêu thích của mình là phở bò'), ['favourite_food=phở bò']);
  assert.deepEqual(fav('私の好きな色は青です'), ['favourite_colour=青']);
  assert.deepEqual(fav('My favourite podcast is Hardcore History'), ['favourite_podcast=Hardcore History']);
  assert.deepEqual(fav('My car is a Honda Civic'), [], 'no generic "my X is Y"');
});

test('open schema offline: favourite colour is remembered and recalled, with labels in each language', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'My favourite colour is blue', lang: 'en' });
  b.advanceClock(2 / 24);
  const r = await b.recall({ agentId: 'mia', text: 'What colour should the gift wrap be?', lang: 'en' });
  assert.ok(r.memories.some((m) => /blue/.test(m.text)), r.promptBlock);
  for (const [lang, say, ask, want] of [
    ['vi', 'Màu yêu thích của tôi là xanh lá', 'Gói quà bằng giấy màu gì nhỉ?', /xanh lá/],
    ['ja', '私の好きな色は青です', 'プレゼントの包装紙は何色がいい？', /青/],
  ]) {
    const bl = makeBrain();
    await bl.think({ agentId: 'mia', text: say, lang });
    bl.advanceClock(2 / 24);
    const rl = await bl.recall({ agentId: 'mia', text: ask, lang });
    assert.ok(rl.memories.some((m) => want.test(m.text)), `${lang}: ${rl.promptBlock}`);
  }
  assert.equal(relationLabel('favourite_colour', 'vi'), 'màu yêu thích');
  assert.equal(relationLabel('favourite_colour', 'ja'), '好きな色');
});
test('admin: promoting a relation widens it for existing facts too, and is audited', async () => {
  const b = makeBrain();
  await b.remember({ agentId: 'kai', facts: [{ relation: 'loyalty_tier', value: 'gold' }], lang: 'en' });
  b.updateRelation('loyalty_tier', { action: 'promote', scope: 'shared', policy: 'trust', label: { vi: 'hạng thành viên', en: 'loyalty tier', ja: '会員ランク' } });
  assert.equal(b.state.facts.find((f) => f.relation === 'loyalty_tier').scope, 'shared');
  const atlas = await b.recall({ agentId: 'atlas', text: 'What loyalty tier is this customer?', lang: 'en' });
  assert.ok(atlas.memories.some((m) => /gold/.test(m.text)));
  assert.ok(b.auditLog(50).some((e) => e.op === 'schema' && e.relation === 'loyalty_tier'));
});

test('admin: core relations only change policy and TTL; merge and delete apply to provisional ones', async () => {
  const b = makeBrain();
  b.updateRelation('lives_in', { action: 'edit', policy: 'human', ttlDays: 400 });
  assert.equal(b.relations('en').find((r) => r.name === 'lives_in').policy, 'human');
  assert.throws(() => b.updateRelation('lives_in', { action: 'promote', scope: 'global' }), /core/);
  assert.throws(() => b.updateRelation('lives_in', { action: 'edit', policy: 'loudest' }), /policy/);
  await b.remember({ agentId: 'mia', facts: [{ relation: 'hometown_city', value: 'Hue' }], lang: 'en' });
  b.updateRelation('hometown_city', { action: 'merge', into: 'lives_in' });
  const f = b.state.facts.find((x) => x.value === 'Hue');
  assert.equal(f.relation, 'lives_in');
  assert.equal(f.scope, 'shared');
  assert.ok(!b.state.relations.hometown_city);
  await b.remember({ agentId: 'mia', facts: [{ relation: 'pet_name', value: 'Rex' }], lang: 'en' });
  assert.equal(b.deleteRelation('pet_name').removedFacts, 1);
  assert.throws(() => b.deleteRelation('lives_in'), /core/);
});

test('admin: the review queue lists conflicts, decisions and suggestions', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  await b.think({ agentId: 'atlas', text: "I'm flying to Tokyo next week", lang: 'en' });
  await b.think({ agentId: 'mia', text: "I'm travelling to Seoul next week", lang: 'en' });
  for (const c of ['x', 'y', 'z']) await b.remember({ agentId: 'kai', customerId: c, facts: [{ relation: 'loyalty_tier', value: 'gold' }], lang: 'en' });
  const r = b.review('en');
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual([r.conflicts[0].a.value, r.conflicts[0].b.value].sort(), ['Da Nang', 'Hanoi']);
  assert.equal(r.decisions.length, 1);
  assert.equal(r.decisions[0].policy, 'latest');
  assert.ok(r.suggestions.some((s) => s.name === 'loyalty_tier'));
});
