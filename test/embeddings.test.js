// Pluggable embeddings: provider client, background backfill, retrieval, storage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { Embedder, embedConfigFromEnv } from '../server/embeddings.js';
import { addEpisode } from '../server/brain/neocortex.js';

// A deterministic OpenAI-compatible /embeddings server. Words map to concepts,
// so paraphrases ("car" / "vehicle" / "drive") land close together.
const CONCEPTS = [
  ['car', 'vehicle', 'automobile', 'drive', 'driving'],
  ['repair', 'shop', 'garage', 'fixed', 'broke', 'broken', 'serviced'],
  ['flight', 'fly', 'flying', 'plane', 'airport'],
  ['food', 'vegetarian', 'meat', 'snack', 'snacks', 'meal'],
  ['allergy', 'allergic', 'peanut', 'peanuts', 'nut', 'nuts'],
];
const DIMS = 16;
function vectorFor(text) {
  const v = new Array(DIMS).fill(0);
  for (const w of String(text).toLowerCase().match(/[a-z]+/g) || []) {
    const c = CONCEPTS.findIndex((ws) => ws.includes(w));
    if (c >= 0) v[c] += 1;
    else v[5 + ([...w].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) % (DIMS - 5))] += 0.15;
  }
  if (v.every((x) => x === 0)) v[DIMS - 1] = 1;
  return v;
}
let server;
let base;
const calls = { batches: 0, inputs: 0, auth: [] };
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      res.setHeader('connection', 'close'); // no keep-alive sockets left behind
      calls.auth.push(req.headers.authorization || null);
      const j = JSON.parse(body || '{}');
      if (j.model === 'slow') await new Promise((r) => setTimeout(r, 800));
      if (j.model === 'broken') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'model crashed' } }));
      }
      const input = Array.isArray(j.input) ? j.input : [j.input];
      calls.batches += 1;
      calls.inputs += input.length;
      const scale = j.model === 'mock-2' ? -1 : 1; // a "different model": different vectors
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: vectorFor(t).map((x) => x * scale) })) }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // On Node 18, root-level after() hooks only run once the event loop is empty,
  // so a listening server must not keep it alive.
  server.unref();
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => {
  server.closeAllConnections(); // fetch keeps connections alive
  server.close();
});

const mockEmbedder = (model = 'mock', extra = {}) => new Embedder({ config: { provider: 'custom', baseUrl: base, model, ...extra } });
const makeBrain = ({ embedder = null, store = new Store(null) } = {}) =>
  new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true, embedder });

test('embeddings: off by default, and a provider key in the env alone does not turn them on', async () => {
  const e = new Embedder({ env: { OPENAI_API_KEY: 'sk-test' } });
  assert.equal(e.available, false);
  assert.deepEqual(await e.embedQuery('hello'), { vec: null, model: null, status: 'off' });
  assert.equal(embedConfigFromEnv({ OPENAI_API_KEY: 'sk-test' }), null);
  const fromEnv = embedConfigFromEnv({ BRAIN_EMBED_PROVIDER: 'ollama' });
  assert.equal(fromEnv.provider, 'ollama');
  assert.equal(fromEnv.model, 'bge-m3', 'a sensible default model is suggested');
});

test('embeddings: client returns normalised vectors, and test() shows paraphrases are close', async () => {
  const e = mockEmbedder();
  assert.equal(e.available, true);
  assert.equal(e.modelId, 'custom:mock');
  const [a] = await e.embedBatch(['my car is in the shop']);
  assert.equal(a.length, DIMS);
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-6, 'unit length');
  const r = await e.test();
  assert.equal(r.ok, true);
  assert.equal(r.dims, DIMS);
  assert.ok(r.similarity > 0.8, `paraphrase similarity ${r.similarity}`);
});

test('embeddings: a slow or failing provider falls back to hashing for the query', async () => {
  const slow = mockEmbedder('slow', { timeoutMs: 150 });
  const q = await slow.embedQuery('hello');
  assert.equal(q.vec, null);
  assert.match(q.status, /timeout/);
  const broken = mockEmbedder('broken');
  const q2 = await broken.embedQuery('hello');
  assert.equal(q2.vec, null);
  assert.match(q2.status, /model crashed|500/);
  assert.equal((await broken.test()).ok, false);
});

test('embeddings: the API key is sent but never exposed', async () => {
  const e = mockEmbedder('mock', { apiKey: 'sk-secret-1234' });
  await e.embedBatch(['x']);
  assert.equal(calls.auth.at(-1), 'Bearer sk-secret-1234');
  const pub = JSON.stringify(e.publicConfig());
  assert.ok(!pub.includes('sk-secret'), 'public config has no key');
  assert.match(pub, /1234/, 'only a hint');
});

test('embeddings: backfill gives every memory a model vector, and redoes them after a model change', async () => {
  const embedder = mockEmbedder();
  const b = makeBrain({ embedder });
  await b.think({ agentId: 'kai', text: 'My car broke down, it will be in the shop for 3 days', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I am vegetarian', lang: 'en' });
  await b.embedQueue.drain();
  const items = [...b.state.facts, ...b.state.episodes];
  assert.ok(items.length >= 4);
  assert.ok(items.every((x) => x.vecModel === 'custom:mock' && x.vec?.length === DIMS), 'all items indexed');
  assert.equal(b.embedQueue.status().done, b.embedQueue.status().total);

  const before = calls.inputs;
  embedder.configure({ model: 'mock-2' }, { persist: false });
  b.embedQueue.kick();
  await b.embedQueue.drain();
  assert.ok(items.every((x) => x.vecModel === 'custom:mock-2'), 'redone for the new model');
  assert.ok(calls.inputs - before >= items.length);
});

test('embeddings: backfill errors are reported and never block writes', async () => {
  const b = makeBrain({ embedder: mockEmbedder('broken') });
  const r = await b.think({ agentId: 'mia', text: 'I am vegetarian', lang: 'en' });
  assert.ok(r.reply, 'the turn completes');
  await b.embedQueue.drain({ untilError: true });
  const st = b.embedQueue.status();
  assert.match(st.lastError || '', /model crashed|500/);
  assert.equal(st.done, 0);
  b.embedQueue.stop();
});

test('embeddings: a paraphrase finds the fact that hashing misses', async () => {
  // The multi-hop failure from the benchmark: Mia asks about getting to the
  // airport; the car fact shares no words with the question.
  const ask = async (b) => {
    await b.think({ agentId: 'kai', text: 'My car broke down, it will be in the shop for 3 days', lang: 'en' });
    await b.embedQueue?.drain();
    const r = await b.recall({ agentId: 'mia', text: 'Can I drive to the airport tomorrow?', lang: 'en' });
    return r.memories.map((m) => m.text);
  };
  const hashing = await ask(makeBrain());
  assert.ok(!hashing.some((t) => /no car for 3 days/.test(t)), 'hashing misses it (baseline behaviour)');
  const model = await ask(makeBrain({ embedder: mockEmbedder() }));
  assert.ok(model.some((t) => /no car for 3 days/.test(t)), 'the model vector finds it');
});

test('embeddings: permissions still block private facts, however similar', async () => {
  const b = makeBrain({ embedder: mockEmbedder() });
  await b.think({ agentId: 'sage', text: 'I am allergic to peanuts', lang: 'en' });
  await b.embedQueue.drain();
  const r = await b.recall({ agentId: 'atlas', text: 'peanut allergy nuts allergic', lang: 'en' });
  assert.ok(!r.memories.some((m) => /peanut/.test(m.text)));
  assert.ok(!/peanut/.test(r.promptBlock.split('## Working memory')[0]), 'not in the memory sections of the prompt');
});

test('embeddings: only redacted text is sent to the provider', async () => {
  const seen = [];
  const embedder = mockEmbedder();
  const orig = embedder.embedBatch.bind(embedder);
  embedder.embedBatch = async (texts, o) => {
    seen.push(...texts);
    return orig(texts, o);
  };
  const b = makeBrain({ embedder });
  await b.think({ agentId: 'mia', text: 'Call me at 0912 345 678 or mail me at an@example.com', lang: 'en' });
  await b.embedQueue.drain();
  await b.recall({ agentId: 'nova', text: 'My number is 0912 345 678', lang: 'en' });
  assert.ok(seen.length > 0);
  assert.ok(!seen.some((t) => /0912|example\.com/.test(t)), `no raw PII: ${seen.join(' | ')}`);
});

test('embeddings: model vectors persist, and an old database gains the column without losing data', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-embed-')), 'brain.db');
  const s1 = new Store(file);
  const b1 = makeBrain({ embedder: mockEmbedder(), store: s1 });
  await b1.think({ agentId: 'mia', text: 'I am vegetarian', lang: 'en' });
  await b1.embedQueue.drain();
  s1.close();

  const s2 = new Store(file);
  const f = s2.state.facts.find((x) => x.relation === 'diet');
  assert.equal(f.vecModel, 'custom:mock');
  assert.equal(f.vec.length, DIMS);
  s2.close();

  // Simulate a database from before this feature.
  const db = new Database(file);
  db.exec('ALTER TABLE facts DROP COLUMN vec; ALTER TABLE episodes DROP COLUMN vec;');
  db.close();
  const s3 = new Store(file);
  assert.ok(s3.state.facts.some((x) => x.relation === 'diet'), 'data kept');
  const cols = s3.db.prepare('PRAGMA table_info(facts)').all().map((c) => c.name);
  assert.ok(cols.includes('vec'), 'column added back');
  s3.close();
});

test('embeddings: recall is async and reports which similarity was used', async () => {
  const b = makeBrain({ embedder: mockEmbedder() });
  await b.think({ agentId: 'mia', text: 'I am vegetarian', lang: 'en' });
  await b.embedQueue.drain();
  const p = b.recall({ agentId: 'nova', text: 'snack ideas', lang: 'en', includeSteps: true });
  assert.ok(p instanceof Promise);
  const r = await p;
  const ras = r.steps.filter((s) => s.region === 'ras');
  assert.match(JSON.stringify(ras.map((s) => s.detail)), /custom:mock/);
});

test('embeddings: hybrid retrieval keeps exact matches the model vector blurs', async () => {
  // The mock model ignores digits, so all twelve orders get the same model
  // vector: only the lexical (hashing) signal can tell ORD-48207 apart.
  const b = makeBrain({ embedder: mockEmbedder() });
  for (let i = 0; i < 12; i++) {
    addEpisode(b, { customerId: 'kh-001', agentId: 'nova', ownerDomain: 'shopping', scope: 'shared', kind: 'session', text: `[Nova] My order ORD-482${String(i).padStart(2, '0')} for a snack box has not arrived` });
  }
  await b.embedQueue.drain();
  const r = await b.recall({ agentId: 'mia', text: 'what is going on with order 48207', lang: 'en' });
  const episodes = r.memories.filter((m) => m.kind === 'episodic');
  // Without fusion all twelve tie on the model score and the order is luck;
  // with it, the exact match ranks first.
  assert.match(episodes[0]?.text || '', /ORD-48207/, episodes.map((m) => `${m.text.match(/ORD-\d+/)} ${m.score}`).join(' | '));
});
