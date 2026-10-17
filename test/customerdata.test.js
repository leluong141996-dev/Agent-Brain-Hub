// v0.8.1: export and erase everything about one customer (#4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';

const makeBrain = (store = new Store(null)) => new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });

// A customer with history, a private fact, a session, a conflict decision and a learned relation.
async function seed(b, id, city, newCity, allergen = 'peanuts') {
  b.createCustomer({ id, name: `Customer ${id}` });
  await b.think({ agentId: 'mia', customerId: id, text: `I live in ${city}`, lang: 'en' });
  await b.think({ agentId: 'mia', customerId: id, text: `I moved to ${newCity} last month`, lang: 'en' });
  await b.think({ agentId: 'sage', customerId: id, text: `I am allergic to ${allergen}`, lang: 'en' });
  await b.think({ agentId: 'atlas', customerId: id, text: `I'm flying to Tokyo next week`, lang: 'en' });
  await b.think({ agentId: 'mia', customerId: id, text: "I'm travelling to Seoul next week", lang: 'en' }); // latest wins: a decision
  await b.remember({ agentId: 'mia', customerId: id, facts: [{ relation: 'loyalty_tier', value: `gold-${id}` }], lang: 'en' });
  await b.sleep({ customerId: id, lang: 'en' });
}

test('export: everything about one customer, with history, and nothing about others', async () => {
  const b = makeBrain();
  await seed(b, 'alice', 'Hanoi', 'Saigon');
  await seed(b, 'bob', 'Hue', 'Vinh', 'shellfish');
  const x = b.exportCustomer('alice');
  assert.equal(x.customer.id, 'alice');
  assert.ok(x.exportedAt);
  assert.ok(x.facts.some((f) => f.value === 'Hanoi' && f.invalidReason === 'superseded'), 'the replaced value is in the export, as history');
  assert.ok(x.facts.some((f) => f.value === 'Saigon') && x.facts.some((f) => f.value === 'peanuts'));
  assert.ok(x.episodes.length > 0 && x.working?.turns?.length > 0 && x.decisions.length > 0);
  const json = JSON.stringify(x);
  assert.ok(!json.includes('Vinh') && !json.includes('gold-bob'), "nothing of bob's");
  assert.ok(!/"embedding"|"vec"/.test(json), 'no embeddings');
  assert.throws(() => b.exportCustomer('nobody'), (e) => e.status === 404);
  assert.throws(() => b.exportCustomer('*'), (e) => e.status === 400);
});

test('erase: nothing about the customer is left, the others are untouched, and the audit keeps no value', async () => {
  const b = makeBrain();
  await seed(b, 'alice', 'Hanoi', 'Saigon');
  await seed(b, 'bob', 'Hue', 'Vinh', 'shellfish');
  const bobBefore = JSON.stringify(b.exportCustomer('bob').facts.map((f) => f.value));
  const r = b.eraseCustomer('alice');
  assert.ok(r.facts >= 5 && r.episodes >= 1 && r.turns >= 1 && r.decisions >= 1, JSON.stringify(r));
  assert.equal(b.state.customers.alice, undefined);
  const s = JSON.stringify({ facts: b.state.facts, episodes: b.state.episodes, working: b.state.working, traces: b.state.traces, insights: b.state.insights, decisions: b.state.decisions, relations: b.state.relations, sleep: b.state.sleep, bus: b.bus.log, customers: b.state.customers });
  for (const needle of ['alice', 'Hanoi', 'Saigon', 'peanuts', 'gold-alice']) assert.ok(!s.includes(needle), `"${needle}" is gone`);
  assert.equal(JSON.stringify(b.exportCustomer('bob').facts.map((f) => f.value)), bobBefore, 'bob is untouched');
  assert.ok(b.state.relations.loyalty_tier, 'the learned relation stays (others may use it)');
  assert.ok(!b.state.relations.loyalty_tier.customers.includes('alice'));
  const entry = b.auditLog(20).find((e) => e.op === 'erase');
  assert.equal(entry.customerId, 'alice');
  assert.ok(!/Hanoi|Saigon|peanut|gold-alice/.test(JSON.stringify(entry)), 'the audit says how much was erased, never what');
  const recall = await b.recall({ agentId: 'mia', customerId: 'alice', text: 'Where do I live?', lang: 'en' });
  assert.ok(!/Hanoi|Saigon/.test(recall.promptBlock));
});

test('erase: company-wide policies and unknown customers are refused', () => {
  const b = makeBrain();
  const n = b.state.facts.length;
  assert.throws(() => b.eraseCustomer('*'), (e) => e.status === 400);
  assert.throws(() => b.eraseCustomer('nobody'), (e) => e.status === 404);
  assert.equal(b.state.facts.length, n);
});

test('erase: persists, so a restart does not bring anything back', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-erase-')), 'brain.db');
  const s1 = new Store(file);
  const b1 = makeBrain(s1);
  await seed(b1, 'alice', 'Hanoi', 'Saigon');
  b1.eraseCustomer('alice');
  s1.close();
  const s2 = new Store(file);
  const raw = JSON.stringify({ facts: s2.state.facts, episodes: s2.state.episodes, working: s2.state.working, traces: s2.state.traces, insights: s2.state.insights, customers: s2.state.customers });
  assert.ok(!raw.includes('alice') && !raw.includes('Hanoi'), 'nothing of alice after a reopen');
  s2.close();
});

test('customer data over REST: admin only, export then erase', async () => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-cd-'));
  const port = 4900 + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT: String(port), BRAIN_DB: path.join(dir, 'brain.db'), BRAIN_SETTINGS: path.join(dir, 'settings.json'), BRAIN_OFFLINE: '1', BRAIN_ADMIN_TOKEN: 'secret' };
  const hub = spawn(process.execPath, [path.join(here, '..', 'server', 'index.js')], { env, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) {
      if (await fetch(`${url}/healthz`).then((r) => r.ok).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const call = (method, p, body, token = 'secret') => fetch(url + p, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    await call('POST', '/api/customers', { id: 'zed', name: 'Zed' });
    await call('POST', '/api/chat', { agentId: 'mia', customerId: 'zed', text: 'I live in Hanoi', lang: 'en' });
    assert.equal((await call('GET', '/api/customers/zed/export', undefined, null)).status, 401, 'export needs the admin token');
    assert.equal((await call('DELETE', '/api/customers/zed', undefined, 'wrong')).status, 401, 'erase needs the admin token');
    const exp = await (await call('GET', '/api/customers/zed/export')).json();
    assert.ok(exp.facts.some((f) => f.value === 'Hanoi'));
    const er = await (await call('DELETE', '/api/customers/zed')).json();
    assert.ok(er.facts >= 1);
    assert.equal((await call('GET', '/api/customers/zed/export')).status, 404);
  } finally {
    hub.kill();
  }
});
