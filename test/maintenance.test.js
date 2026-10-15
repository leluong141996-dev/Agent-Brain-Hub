// v0.8: memory that maintains itself — agents correct and forget facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { stateAt } from '../server/brain/temporal.js';
import { trustOf } from '../server/brain/trust.js';

const makeBrain = (llm = new LLM({ offline: true })) => new Brain({ store: new Store(null), bus: new NeuralBus(), llm, deterministic: true });
const live = (b, relation) => b.state.facts.filter((f) => f.relation === relation && ['active', 'conflicted'].includes(stateAt(f, b.clock.now())));

test('correct: replaces a wrong value, keeps the old one as history, and costs the writer trust', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  const before = b.clock.now();
  b.advanceClock(1 / 24);
  const r = b.correct({ agentId: 'kai', customerId: 'kh-001', relation: 'lives_in', value: 'Saigon', reason: 'customer says Hanoi was a mistake' });
  assert.equal(r.corrected.length, 1);
  assert.deepEqual(live(b, 'lives_in').map((f) => f.value), ['Saigon']);
  const hanoi = b.state.facts.find((f) => f.value === 'Hanoi');
  assert.equal(hanoi.invalidReason, 'corrected');
  assert.equal(hanoi.correctedBy, 'kai');
  assert.ok(trustOf(b, 'mia') < 0.5, 'the writer of the wrong value loses trust');
  const past = await b.recall({ agentId: 'atlas', text: 'Book a taxi from my home', lang: 'en', asOf: before });
  assert.ok(past.memories.some((m) => /Hanoi/.test(m.text)), 'history before the correction is unchanged');
  const now = await b.recall({ agentId: 'atlas', text: 'Book a taxi from my home', lang: 'en' });
  assert.ok(now.memories.some((m) => /Saigon/.test(m.text)) && !now.memories.some((m) => /lives in: Hanoi/.test(m.text)));
  assert.ok(b.auditLog(20).some((e) => e.op === 'correct' && e.relation === 'lives_in'));
});

test('correct: wrongValue picks one value of a multi-valued relation; no value just drops it', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I like coffee', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I like green tea', lang: 'en' });
  b.correct({ agentId: 'mia', customerId: 'kh-001', relation: 'prefers', wrongValue: 'coffee' });
  assert.deepEqual(live(b, 'prefers').map((f) => f.value), ['green tea']);
});

test('correct: cannot reach what the agent cannot see, and does not reveal that it exists', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'sage', text: 'I am allergic to peanuts', lang: 'en' });
  const hidden = (() => {
    try {
      b.correct({ agentId: 'atlas', customerId: 'kh-001', relation: 'allergic_to', value: 'none' });
    } catch (e) {
      return e;
    }
  })();
  const absent = (() => {
    try {
      b.correct({ agentId: 'atlas', customerId: 'kh-002', relation: 'allergic_to', value: 'none' });
    } catch (e) {
      return e;
    }
  })();
  assert.equal(hidden.status, 404);
  assert.equal(hidden.status, absent.status);
  assert.equal(hidden.message, absent.message, 'same answer whether a private fact exists or not');
  assert.deepEqual(live(b, 'allergic_to').map((f) => f.value), ['peanuts']);
});

test('correct: a read-only agent cannot correct', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  b.updateAgent('kai', { permissions: { write: false } });
  assert.throws(() => b.correct({ agentId: 'kai', customerId: 'kh-001', relation: 'lives_in', value: 'Saigon' }), (e) => e.status === 403);
});

test('forget: the value is gone everywhere, including history, and the audit keeps no value', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'sage', text: 'I am allergic to peanuts', lang: 'en' });
  await b.think({ agentId: 'sage', text: 'Peanuts make my throat swell', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' }); // the conversation becomes a session episode
  await b.remember({ agentId: 'sage', facts: [{ relation: 'trigger_food', value: 'peanuts' }], lang: 'en' });
  const before = b.clock.now();
  b.advanceClock(1 / 24);
  const r = b.forget({ agentId: 'sage', customerId: 'kh-001', relation: 'allergic_to', value: 'peanuts' });
  assert.equal(r.removedFacts, 1);
  assert.ok(r.scrubbed >= 1);
  const s = JSON.stringify({ facts: b.state.facts.filter((f) => f.relation === 'allergic_to'), episodes: b.state.episodes, working: b.state.working, traces: b.state.traces, insights: b.state.insights });
  assert.ok(!/peanut/i.test(s), 'no trace of the value in memory');
  const past = await b.recall({ agentId: 'sage', text: 'peanut allergy', lang: 'en', asOf: before });
  assert.ok(!/peanut/i.test(past.promptBlock), 'not even when looking back');
  const entry = b.auditLog(10).find((e) => e.op === 'forget');
  assert.equal(entry.relation, 'allergic_to');
  assert.ok(!/peanut/i.test(JSON.stringify(entry)), 'the audit says what was forgotten, never the value');
});

test('forget: an agent cannot forget what it cannot see, and the answer is the same as for nothing', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'sage', text: 'I am allergic to peanuts', lang: 'en' });
  const r = b.forget({ agentId: 'atlas', customerId: 'kh-001', relation: 'allergic_to' });
  const none = b.forget({ agentId: 'atlas', customerId: 'kh-002', relation: 'allergic_to' });
  assert.deepEqual(r, none);
  assert.equal(r.removedFacts, 0);
  assert.deepEqual(live(b, 'allergic_to').map((f) => f.value), ['peanuts']);
  assert.ok(b.state.episodes.concat(Object.values(b.state.working).flatMap((w) => w.turns)).some((x) => /peanut/.test(x.text)), 'nothing scrubbed either');
});

test('forget: without a value, every version of the relation the agent can see is removed', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I moved to Saigon last month', lang: 'en' });
  const r = b.forget({ agentId: 'mia', customerId: 'kh-001', relation: 'lives_in' });
  assert.equal(r.removedFacts, 2);
  assert.equal(b.state.facts.filter((f) => f.relation === 'lives_in').length, 0);
});

test('correct and forget over REST (SDK) and MCP', async () => {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { BrainClient } = await import('../sdk/brain-client.js');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-maint-'));
  const port = 4700 + Math.floor(Math.random() * 200);
  const env = { ...process.env, PORT: String(port), BRAIN_DB: path.join(dir, 'brain.db'), BRAIN_SETTINGS: path.join(dir, 'settings.json'), BRAIN_OFFLINE: '1', BRAIN_ADMIN_TOKEN: 't' };
  const hub = spawn(process.execPath, [path.join(here, '..', 'server', 'index.js')], { env, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) {
      if (await fetch(`${url}/healthz`).then((r) => r.ok).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const admin = (p, body) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 't' }, body: JSON.stringify(body) }).then((r) => r.json());
    const { apiKey } = await admin('/api/agents', { name: 'Helper', domain: 'personal', kind: 'external' });
    const client = new BrainClient({ url, apiKey });
    await client.remember({ customerId: 'c1', facts: [{ relation: 'lives_in', value: 'Hanoi' }], lang: 'en' });
    const c = await client.correct({ customerId: 'c1', relation: 'lives_in', value: 'Saigon', lang: 'en' });
    assert.match(c.fact, /Saigon/);
    const f = await client.forget({ customerId: 'c1', relation: 'lives_in' });
    assert.equal(f.removedFacts, 2);
    await assert.rejects(client.correct({ customerId: 'c1', relation: 'lives_in', value: 'Hue' }), (e) => e.status === 404);

    const mcp = spawn(process.execPath, [path.join(here, '..', 'mcp', 'server.mjs')], { env: { ...process.env, BRAIN_URL: url, BRAIN_API_KEY: apiKey }, stdio: ['pipe', 'pipe', 'ignore'] });
    const out = await new Promise((resolve) => {
      let buf = '';
      mcp.stdout.on('data', (d) => {
        buf += d;
        if (buf.includes('\n')) resolve(buf);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    });
    mcp.kill();
    const tools = JSON.parse(out.split('\n')[0]).result.tools.map((t) => t.name);
    assert.ok(tools.includes('brain_correct') && tools.includes('brain_forget'), tools.join(','));
  } finally {
    hub.kill();
  }
});
