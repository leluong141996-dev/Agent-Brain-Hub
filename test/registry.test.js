// v0.7: the ontology as data — core relations, provisional relations, overrides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { normalizeName, relationOf, ensureRelation, listRelations, MAX_PROVISIONAL } from '../server/brain/registry.js';
import { relationLabel } from '../server/brain/ontology.js';

const makeBrain = (store = new Store(null)) => new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const mia = { id: 'mia', domain: 'personal' };

test('registry: names are normalised, and synonyms land on core relations', () => {
  assert.equal(normalizeName('Favorite Color'), 'favourite_colour');
  assert.equal(normalizeName('favourite-colour'), 'favourite_colour');
  assert.equal(normalizeName('Màu yêu thích'), 'mau_yeu_thich');
  assert.equal(normalizeName('likes'), 'prefers');
  assert.equal(normalizeName('home_city'), 'lives_in');
  assert.equal(normalizeName('x'.repeat(60)).length, 40);
});

test('registry: core relations keep their definition and get a default policy', () => {
  const b = makeBrain();
  const r = relationOf(b, 'lives_in');
  assert.equal(r.status, 'core');
  assert.equal(r.scope, 'shared');
  assert.equal(r.owner, 'personal');
  assert.equal(r.policy, 'trust');
  assert.equal(relationOf(b, 'budget').policy, 'latest');
  assert.equal(relationOf(b, 'income').policy, 'owner');
  assert.equal(relationOf(b, 'nope'), null);
});

test('registry: an unknown relation becomes provisional, private to the writer domain', () => {
  const b = makeBrain();
  const r = ensureRelation(b, 'Loyalty Tier', { agent: mia, customerId: 'kh-001', value: 'gold' });
  assert.equal(r.name, 'loyalty_tier');
  assert.equal(r.created, true);
  assert.deepEqual(
    { status: r.rel.status, scope: r.rel.scope, owner: r.rel.owner, ttlDays: r.rel.ttlDays, card: r.rel.card, policy: r.rel.policy, entity: r.rel.entity },
    { status: 'provisional', scope: 'private', owner: 'personal', ttlDays: 30, card: 'one', policy: 'latest', entity: 'customer' }
  );
  ensureRelation(b, 'loyalty_tier', { agent: mia, customerId: 'kh-002', value: 'silver' });
  const again = relationOf(b, 'loyalty_tier');
  assert.equal(again.uses, 2);
  assert.deepEqual(again.customers, ['kh-001', 'kh-002']);
  assert.deepEqual(again.examples, ['gold', 'silver']);
  assert.equal(relationLabel('loyalty_tier', 'en'), 'loyalty tier');
});

test('registry: secret-looking names are rejected; the limit is enforced', () => {
  const b = makeBrain();
  for (const n of ['wifi_password', 'PIN', 'otp_code', 'api_key', 'bank_token', 'seed phrase']) {
    assert.equal(ensureRelation(b, n, { agent: mia, customerId: 'kh-001', value: 'x' }).error, 'secret', n);
  }
  assert.equal(ensureRelation(b, '!!', { agent: mia, customerId: 'kh-001', value: 'x' }).error, 'invalid');
  for (let i = 0; i < MAX_PROVISIONAL; i++) ensureRelation(b, `thing_${i}`, { agent: mia, customerId: 'kh-001', value: 'x' });
  assert.equal(ensureRelation(b, 'one_more', { agent: mia, customerId: 'kh-001', value: 'x' }).error, 'registry_full');
  assert.ok(!b.state.relations.wifi_password);
});

test('registry: list marks provisional relations worth reviewing (≥3 customers or ≥5 uses)', () => {
  const b = makeBrain();
  for (const c of ['a', 'b', 'c']) ensureRelation(b, 'loyalty_tier', { agent: mia, customerId: c, value: 'gold' });
  ensureRelation(b, 'pet_name', { agent: mia, customerId: 'a', value: 'Rex' });
  const list = listRelations(b, 'en');
  assert.ok(list.find((r) => r.name === 'loyalty_tier').worthReview);
  assert.ok(!list.find((r) => r.name === 'pet_name').worthReview);
  assert.ok(list.some((r) => r.name === 'lives_in' && r.status === 'core'));
});

test('registry: provisional relations and labels survive a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-registry-')), 'brain.db');
  const s1 = new Store(file);
  const b1 = makeBrain(s1);
  ensureRelation(b1, 'loyalty_tier', { agent: mia, customerId: 'kh-001', value: 'gold', label: { vi: 'hạng thành viên', en: 'loyalty tier', ja: '会員ランク' } });
  b1.store.save();
  s1.close();
  const s2 = new Store(file);
  const b2 = makeBrain(s2);
  assert.equal(relationOf(b2, 'loyalty_tier').status, 'provisional');
  assert.equal(relationLabel('loyalty_tier', 'vi'), 'hạng thành viên');
  s2.close();
});

// ---- Deferred minors from the v0.7 review ----

test('registry: plural and camelCase spellings of a favourite land on one relation', () => {
  assert.equal(normalizeName('Favorite Colors'), 'favourite_colour');
  assert.equal(normalizeName('favoriteColor'), 'favourite_colour');
  assert.equal(normalizeName('loyaltyTier'), 'loyalty_tier');
  assert.equal(normalizeName('favourite_glass'), 'favourite_glass', 'a word ending in "ss" is not a plural');
});

test('registry: labels come back from storage after a restart (not from a process-wide cache)', async () => {
  const { setRelationLabel } = await import('../server/brain/ontology.js');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-registry-')), 'brain.db');
  const s1 = new Store(file);
  const b1 = makeBrain(s1);
  ensureRelation(b1, 'member_rank', { agent: mia, customerId: 'kh-001', value: 'gold', label: { vi: 'hạng hội viên', en: 'member rank', ja: '会員ランク' } });
  b1.store.save();
  s1.close();
  setRelationLabel('member_rank', null); // a fresh process has no labels in memory
  assert.equal(relationLabel('member_rank', 'vi'), 'member rank');
  const s2 = new Store(file);
  makeBrain(s2);
  assert.equal(relationLabel('member_rank', 'vi'), 'hạng hội viên');
  s2.close();
});
