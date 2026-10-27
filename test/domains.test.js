// Configurable domains: a team defines its own agent specialties (intents,
// retention, privacy, which relations an intent needs) without editing code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { DOMAINS } from '../server/agents.js';

const makeBrain = (store = new Store(null)) => new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const LEGAL = {
  label: 'Legal & compliance',
  color: '#0f766e',
  retentionDays: 3650,
  episodeScope: 'private',
  intents: { review_contract: ['contract', 'clause', 'nda', 'hợp đồng', '契約'], gdpr_request: ['gdpr', 'data request', 'dsar'] },
  intentRelations: { review_contract: ['governing_law'] },
};

test('domains: an admin defines a domain, and agents of that domain work end to end', async () => {
  const b = makeBrain();
  const d = b.putDomain('legal', LEGAL);
  assert.equal(d.id, 'legal');
  assert.equal(d.builtin, false);
  const lawyer = b.createAgent({ name: 'Lex', domain: 'legal', kind: 'external' }).agent.id;
  const r = await b.think({ agentId: lawyer, customerId: 'acme', text: 'Please review the NDA clause on termination', lang: 'en' });
  assert.equal(r.intent.intent, 'review_contract', 'custom intent keywords are used');
  await b.remember({ agentId: lawyer, customerId: 'acme', facts: [{ relation: 'governing_law', value: 'the laws of Singapore' }], lang: 'en' });
  const rec = await b.recall({ agentId: lawyer, customerId: 'acme', text: 'Check this contract for me', lang: 'en' });
  assert.ok(rec.memories.some((m) => /Singapore/.test(m.text)), 'intentRelations pulls the relation the intent needs');
  const list = b.listDomains('en');
  assert.ok(list.some((x) => x.id === 'legal' && x.label === 'Legal & compliance' && !x.builtin));
  assert.ok(list.some((x) => x.id === 'repair' && x.builtin));
});

test('domains: a private domain keeps its sessions away from other domains', async () => {
  const b = makeBrain();
  b.putDomain('legal', LEGAL);
  const lawyer = b.createAgent({ name: 'Lex', domain: 'legal', kind: 'external' }).agent.id;
  await b.think({ agentId: lawyer, customerId: 'acme', text: 'The settlement amount with Globex is confidential: 2 million', lang: 'en' });
  await b.sleep({ customerId: 'acme', lang: 'en' });
  const other = await b.recall({ agentId: 'mia', customerId: 'acme', text: 'What is the settlement with Globex?', lang: 'en' });
  assert.ok(!other.memories.some((m) => /settlement/i.test(m.text)), 'episodes of a private domain stay private');
});

test('domains: built-ins cannot be changed; bad input is refused; a domain in use cannot be deleted', () => {
  const b = makeBrain();
  assert.throws(() => b.putDomain('repair', LEGAL), /built-in/);
  assert.throws(() => b.putDomain('Bad Id', LEGAL), /id/);
  assert.throws(() => b.putDomain('legal', { ...LEGAL, episodeScope: 'everyone' }), /episodeScope/);
  assert.throws(() => b.putDomain('legal', { ...LEGAL, intents: { x: 'not a list' } }), /intents/);
  assert.throws(() => b.putDomain('legal', { ...LEGAL, label: '' }), /label/);
  b.putDomain('legal', LEGAL);
  b.createAgent({ name: 'Lex', domain: 'legal', kind: 'external' });
  assert.throws(() => b.deleteDomain('legal'), /in use/);
  b.putDomain('ops', { label: 'Ops', intents: {} });
  b.deleteDomain('ops');
  assert.ok(!b.listDomains('en').some((x) => x.id === 'ops'));
  assert.throws(() => b.deleteDomain('repair'), /built-in/);
});

test('domains: they survive a restart, and one brain does not see another brain\'s domains', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abh-dom-'));
  const file = path.join(dir, 'brain.db');
  const b1 = makeBrain(new Store(file));
  b1.putDomain('legal', LEGAL);
  b1.store.flush();
  b1.store.close();
  const b2 = makeBrain(new Store(file));
  assert.ok(b2.listDomains('en').some((x) => x.id === 'legal'), 'persisted');
  b2.store.close();
  const fresh = makeBrain();
  assert.ok(!fresh.listDomains('en').some((x) => x.id === 'legal'), 'a new brain starts with the built-ins only');
  assert.ok(!DOMAINS.legal);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('domains: BRAIN_DOMAINS loads domains from a file (configuration as code), read-only over the API', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abh-domf-'));
  const file = path.join(dir, 'domains.json');
  fs.writeFileSync(file, JSON.stringify({ domains: { legal: LEGAL } }));
  process.env.BRAIN_DOMAINS = file;
  try {
    const b = makeBrain();
    const legal = b.listDomains('en').find((x) => x.id === 'legal');
    assert.equal(legal.source, 'file');
    assert.throws(() => b.putDomain('legal', { ...LEGAL, label: 'Changed' }), /BRAIN_DOMAINS/);
    assert.throws(() => b.deleteDomain('legal'), /BRAIN_DOMAINS/);
  } finally {
    delete process.env.BRAIN_DOMAINS;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
