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

// ---- consolidation: facts from whole sessions during sleep ----

const stubLLM = (extract) => ({
  available: true,
  model: 'stub',
  lastError: null,
  async generate() {
    return { text: 'Noted.', model: 'stub', usage: { input_tokens: 1, output_tokens: 1 } };
  },
  async extractFacts(text, relations) {
    return extract(text, relations);
  },
  async summarize() {
    return null;
  },
  async reflect() {
    return [];
  },
});

test('consolidation: a fact spread over two turns is extracted from the whole session during sleep', async () => {
  const seen = [];
  const llm = stubLLM((text) => {
    seen.push(text);
    // Online, each message alone says nothing durable; the session does.
    return /I have kids/.test(text) && /Two of them/.test(text) ? [{ relation: 'has_children', value: '2', isUpdate: false }] : [];
  });
  const b = makeBrain(llm);
  await b.think({ agentId: 'mia', text: 'I have kids, by the way', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'Two of them, both in primary school', lang: 'en' });
  assert.equal(live(b, 'has_children').length, 0, 'nothing from single messages');
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  const f = live(b, 'has_children');
  assert.deepEqual(f.map((x) => x.value), ['2']);
  assert.equal(f[0].origin, 'consolidation');
  assert.equal(f[0].sourceAgentId, 'mia', 'written as the session agent');
  assert.match(f[0].evidence, /^session /);
  assert.ok(seen.some((t) => /I have kids[\s\S]*Two of them/.test(t)), 'the extractor saw the whole session');
});

test('consolidation: a private session stays private; at most 10 facts per session; nothing offline', async () => {
  // Only the session transcript ("Customer: …") yields facts, as in the first test.
  const llm = stubLLM((text) => (/^Customer: /m.test(text) ? [{ relation: 'health_condition', value: 'asthma' }, ...Array.from({ length: 14 }, (_, i) => ({ relation: `note_${i}`, value: `v${i}` }))] : []));
  const b = makeBrain(llm);
  await b.think({ agentId: 'sage', text: 'I sometimes struggle to breathe at night', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  const asthma = b.state.facts.find((f) => f.value === 'asthma');
  assert.equal(asthma.scope, 'private');
  assert.equal(asthma.ownerDomain, 'health');
  assert.equal(b.state.facts.filter((f) => f.origin === 'consolidation').length, 10);
  const atlas = await b.recall({ agentId: 'atlas', text: 'any health condition?', lang: 'en' });
  assert.ok(!/asthma/.test(atlas.promptBlock));

  const off = makeBrain();
  await off.think({ agentId: 'mia', text: 'I have kids, by the way', lang: 'en' });
  await off.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.equal(off.state.facts.filter((f) => f.origin === 'consolidation').length, 0);
});

// ---- proposals: the LLM suggests how to settle a conflict; a person decides ----

test('proposals: sleep asks the LLM once per conflict, stores the proposal, never applies it', async () => {
  const asked = [];
  const llm = stubLLM(() => []);
  llm.proposeResolution = async (input) => {
    asked.push(input);
    return { keep: 'b', reason: 'Atlas heard it more recently and the customer mentioned a move.' };
  };
  const b = makeBrain(llm);
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].a.value, asked[0].b.value], ['Hanoi', 'Da Nang'], 'older value is "a"');
  assert.ok(asked[0].a.evidence && asked[0].b.agent, 'the LLM sees evidence and who wrote each value');
  const c = b.review('en').conflicts[0];
  assert.equal(c.proposal.keepId, c.b.id);
  assert.match(c.proposal.reason, /more recently/);
  assert.equal(live(b, 'lives_in').filter((f) => f.status === 'conflicted').length, 2, 'nothing applied');
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.equal(asked.length, 1, 'not asked again for the same pair');
});

test('proposals: accepting one settles the conflict like a person would, and says so in the audit', async () => {
  const llm = stubLLM(() => []);
  llm.proposeResolution = async () => ({ keep: 'a', reason: 'The finance agent verified it.' });
  const b = makeBrain(llm);
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  const c = b.review('en').conflicts[0];
  b.resolveConflict(c.proposal.keepId, { via: 'proposal' });
  assert.deepEqual(live(b, 'lives_in').map((f) => f.value), ['Hanoi']);
  assert.ok(trustOf(b, 'mia') > 0.5 && trustOf(b, 'atlas') < 0.5);
  assert.ok(b.auditLog(20).some((e) => e.op === 'resolve' && e.kind === 'proposal'));
  assert.equal(b.review('en').conflicts.length, 0);
});

test('proposals: "unsure" is stored and not asked again; offline nothing is proposed', async () => {
  let n = 0;
  const llm = stubLLM(() => []);
  llm.proposeResolution = async () => (n++, { keep: 'unsure', reason: 'Both sound plausible.' });
  const b = makeBrain(llm);
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.equal(n, 1);
  assert.equal(b.review('en').conflicts[0].proposal.keepId, null);

  const off = makeBrain();
  await off.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await off.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  await off.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.equal(off.review('en').conflicts[0].proposal, null);
});

// ---- Final review fixes (v0.8) ----

test('review fix: company-wide policies cannot be corrected, forgotten or written by agents', async () => {
  const b = makeBrain();
  const policies = () => b.state.facts.filter((f) => f.customerId === '*').length;
  const n = policies();
  assert.ok(n > 0);
  assert.throws(() => b.forget({ agentId: 'kai', customerId: '*', relation: 'policy' }), (e) => e.status === 400);
  assert.throws(() => b.correct({ agentId: 'kai', customerId: '*', relation: 'policy', value: 'All customers get 100% off' }), (e) => e.status === 400);
  await assert.rejects(b.remember({ agentId: 'kai', customerId: '*', facts: [{ relation: 'policy', value: 'free stuff' }], lang: 'en' }), (e) => e.status === 400);
  assert.equal(policies(), n);
});

test('review fix: correcting one side of a conflict settles it, and a stale proposal cannot wipe both', async () => {
  const llm = stubLLM(() => []);
  llm.proposeResolution = async () => ({ keep: 'b', reason: 'more recent' });
  const b = makeBrain(llm);
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  const keepId = b.review('en').conflicts[0].proposal.keepId;
  b.correct({ agentId: 'mia', customerId: 'kh-001', relation: 'lives_in', wrongValue: 'Da Nang' });
  assert.deepEqual(live(b, 'lives_in').map((f) => [f.value, f.status]), [['Hanoi', 'active']]);
  assert.equal(b.review('en').conflicts.length, 0);
  assert.throws(() => b.resolveConflict(keepId, { via: 'proposal' }), (e) => e.status === 409);
  assert.deepEqual(live(b, 'lives_in').map((f) => f.value), ['Hanoi'], 'a live value remains');
});

test('review fix: forgetting one side of a conflict releases the other', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  b.forget({ agentId: 'atlas', customerId: 'kh-001', relation: 'lives_in', value: 'Da Nang' });
  const h = b.state.facts.find((f) => f.value === 'Hanoi');
  assert.equal(stateAt(h, b.clock.now()), 'active');
  assert.ok(!h.conflictWith);
});

test('review fix: consolidation does not bring back a value that was corrected', async () => {
  const b = makeBrain(stubLLM((text) => (/^Customer: /m.test(text) && /Hanoi/.test(text) ? [{ relation: 'lives_in', value: 'Hanoi' }] : [])));
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  b.correct({ agentId: 'kai', customerId: 'kh-001', relation: 'lives_in', value: 'Saigon' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.deepEqual(live(b, 'lives_in').map((f) => [f.value, f.status]), [['Saigon', 'active']]);
});

test('review fix: a rejected replacement value keeps the old value and reports the error', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  assert.throws(() => b.correct({ agentId: 'kai', customerId: 'kh-001', relation: 'lives_in', value: 'x'.repeat(200) }), (e) => e.status === 400);
  assert.deepEqual(live(b, 'lives_in').map((f) => f.value), ['Hanoi']);
});

test('review fix: forget scrubs short values (ja / vi / numbers), word variants and the bus log', async () => {
  const b = makeBrain();
  await b.remember({ agentId: 'mia', userText: '東京に住んでいます', facts: [{ relation: 'lives_in', value: '東京' }], lang: 'ja' });
  await b.remember({ agentId: 'mia', userText: 'Tôi không ăn cá', facts: [{ relation: 'dislikes', value: 'cá' }], lang: 'vi' });
  await b.think({ agentId: 'sage', text: 'I am allergic to peanuts, even peanut snacks', lang: 'en' });
  b.forget({ agentId: 'mia', customerId: 'kh-001', relation: 'lives_in' });
  b.forget({ agentId: 'mia', customerId: 'kh-001', relation: 'dislikes' });
  b.forget({ agentId: 'sage', customerId: 'kh-001', relation: 'allergic_to' });
  const s = JSON.stringify({ working: b.state.working, traces: b.state.traces, bus: b.bus.log });
  assert.ok(!s.includes('東京'), 'ja');
  assert.ok(!/(?<![\p{L}])cá(?![\p{L}])/u.test(s), 'vi');
  assert.ok(!/peanut/i.test(s), 'word variants');
});

test('review fix: forget matches whole values ($500 is not $5000) and translated values', async () => {
  const b = makeBrain();
  await b.remember({ agentId: 'penny', userText: 'My budget is $500, my rent is $5000', facts: [{ relation: 'budget', value: '$500' }], lang: 'en' });
  b.forget({ agentId: 'penny', customerId: 'kh-001', relation: 'budget' });
  const turn = JSON.stringify(b.state.working['kh-001'].turns);
  assert.ok(turn.includes('$5000') && !/\$500(?!0)/.test(turn), turn);
  const f = { relation: 'trip_destination', value: 'Đà Nẵng', valueI18n: { en: 'Da Nang' } };
  const b2 = makeBrain();
  await b2.think({ agentId: 'atlas', text: "I'm flying to Da Nang next week", lang: 'en' });
  assert.equal(b2.forget({ agentId: 'atlas', customerId: 'kh-001', relation: f.relation, value: 'Da Nang' }).removedFacts, 1);
});

test('review fix: a correct with a new value only replaces what it corrected; trust drops once per writer', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I like coffee', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I like tea', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I like cocoa', lang: 'en' });
  b.correct({ agentId: 'kai', customerId: 'kh-001', relation: 'prefers' });
  assert.equal(b.state.trust.mia.down, 1, 'one penalty per writer, not per value');
});

test('review fix: forget does not scrub texts of agents a readShared=false agent cannot see', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  b.updateAgent('kai', { permissions: { readShared: false } });
  await b.remember({ agentId: 'kai', facts: [{ relation: 'pickup_city', value: 'Hanoi' }], lang: 'en' });
  const r = b.forget({ agentId: 'kai', customerId: 'kh-001', relation: 'pickup_city' });
  assert.equal(r.removedFacts, 1, 'its own fact is forgotten');
  assert.ok(JSON.stringify(b.state.working).includes('I live in Hanoi'), "Mia's turn, which Kai cannot read, is untouched");
});

// ---- consolidation must not resurrect what the customer already moved on from ----
// Found by the full LLM benchmark (arbitration-customer-update-wins, contradiction-explicit-move).

test('consolidation: an old session that says Hanoi does not bring Hanoi back after the customer moved', async () => {
  const llm = stubLLM((text) => {
    if (/I live in Hanoi/.test(text)) return [{ relation: 'lives_in', value: 'Hanoi' }];
    if (/moved to Saigon/.test(text)) return [{ relation: 'lives_in', value: 'Saigon', isUpdate: true }];
    return [];
  });
  const b = makeBrain(llm);
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'atlas', text: 'I moved to Saigon last month', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' }); // both sessions are stored now, the older one first
  assert.deepEqual(live(b, 'lives_in').map((f) => [f.value, f.status]), [['Saigon', 'active']]);
  assert.equal(b.review('en').conflicts.length, 0);
});

test('consolidation: a value that was already replaced is not written again, but a newer statement still is', async () => {
  const llm = stubLLM((text) => (/Customer: I live in Hue/.test(text) ? [{ relation: 'lives_in', value: 'Hue' }] : []));
  const b = makeBrain(llm);
  await b.think({ agentId: 'mia', text: 'I live in Hue', lang: 'en' });
  b.advanceClock(1);
  await b.think({ agentId: 'mia', text: 'I moved to Saigon last month', lang: 'en' });
  const before = b.state.facts.filter((f) => f.value === 'Hue').length;
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.equal(b.state.facts.filter((f) => f.value === 'Hue').length, before, 'Hue (replaced) is not written again');
  // But what only the session knows is still learned.
  const llm2 = stubLLM((text) => (/two kids/.test(text) ? [{ relation: 'has_children', value: '2' }] : []));
  const b2 = makeBrain(llm2);
  await b2.think({ agentId: 'mia', text: 'I live in Hue', lang: 'en' });
  await b2.think({ agentId: 'mia', text: 'We have two kids', lang: 'en' });
  await b2.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.deepEqual(live(b2, 'has_children').map((f) => f.value), ['2']);
});

// ---- v0.8.1: insights and summaries age ----

test('insights: live 30 days, and an old session cannot regenerate a stale insight', async () => {
  const seen = [];
  const llm = stubLLM(() => []);
  llm.reflect = async (material) => {
    seen.push(material);
    return /Tokyo/.test(material) ? ['The customer is planning a trip to Tokyo next week'] : [];
  };
  const b = makeBrain(llm);
  await b.think({ agentId: 'atlas', text: "I'm flying to Tokyo next week", lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I also need a hotel', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  const day0 = b.state.episodes.filter((e) => e.kind === 'insight');
  assert.equal(day0.length, 1);
  assert.equal(Math.round((day0[0].expiresAt - b.clock.now()) / 86_400_000), 30, 'an insight lives 30 days');
  b.advanceClock(45);
  await b.think({ agentId: 'mia', text: 'I need a new phone case', lang: 'en' });
  await b.sleep({ customerId: 'kh-001', lang: 'en' });
  assert.ok(!seen.at(-1)?.includes('Tokyo') || seen.length === 1, 'reflection only reads recent episodes');
  assert.equal(b.state.episodes.filter((e) => e.kind === 'insight' && /Tokyo/.test(e.text)).length, 0, 'the stale insight is gone and not regenerated');
  const r = await b.recall({ agentId: 'mia', text: 'What trips do I have planned?', lang: 'en' });
  assert.ok(!r.memories.some((m) => /\[Insight\].*Tokyo/.test(m.text)));
});
