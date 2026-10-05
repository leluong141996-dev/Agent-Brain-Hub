// SQLite persistence: round-trip, incremental writes, audit trail, migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Brain } from '../server/brain/index.js';
import { Store, emptyState } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-db-'));
const brainOn = (store) => new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });

async function scenario(b) {
  await b.think({ agentId: 'kai', text: 'Tên tôi là Lê Minh. Xe của tôi là Toyota Vios, xe hỏng phải sửa 3 ngày' });
  await b.think({ agentId: 'sage', text: 'Tôi bị dị ứng hải sản' });
  const r = await b.think({ agentId: 'atlas', text: 'Tôi cần đặt vé máy bay đi Đà Nẵng' });
  b.feedback({ traceId: r.traceId, actionId: r.actions[0].id, accepted: true });
  b.createAgent({ name: 'Lumi', domain: 'repair', kind: 'external' });
  await b.sleep();
}

test('SQLite round-trip: reopening the database restores the whole brain', async () => {
  const file = path.join(tmp(), 'brain.db');
  const s1 = new Store(file);
  const b1 = brainOn(s1);
  await scenario(b1);
  s1.close();

  const s2 = new Store(file);
  const b2 = brainOn(s2);
  const a = b1.state;
  const z = b2.state;
  assert.deepEqual(z.agents.map((x) => x.id), a.agents.map((x) => x.id), 'agents keep their order');
  assert.equal(z.facts.length, a.facts.length);
  assert.equal(z.episodes.length, a.episodes.length);
  assert.equal(z.episodes[0].embedding.length, 256, 'embeddings come back from the BLOB');
  assert.ok(Math.abs(z.facts[3].embedding[5] - a.facts[3].embedding[5]) < 1e-3);
  assert.deepEqual(z.bandit, a.bandit);
  assert.deepEqual(Object.keys(z.traces).sort(), Object.keys(a.traces).sort());
  assert.equal(z.seq, a.seq, 'id sequence continues');
  assert.deepEqual(z.stats.totals, a.stats.totals);
  // The restored brain keeps working and remembers across restarts.
  const r = await b2.think({ agentId: 'atlas', text: 'Đặt taxi ra sân bay giúp tôi' });
  assert.ok(r.retrieval.selected.some((x) => /không có xe 3 ngày/.test(x.text)));
  s2.close();
});

test('flush writes only the rows that changed', async () => {
  const file = path.join(tmp(), 'brain.db');
  const store = new Store(file);
  const b = brainOn(store);
  await scenario(b);
  store.flush();
  assert.deepEqual(store.flush(), { upserts: 0, deletes: 0, ms: store.lastFlush.ms }, 'nothing changed → nothing written');
  b.setVip('kh-001', true);
  const f = store.flush();
  assert.equal(f.upserts, 1, 'one customer row');
  assert.equal(f.deletes, 0);
  b.deleteAgent('lumi');
  assert.equal(store.flush().deletes, 1);
  store.close();
});

test('audit trail lives in SQLite, is never truncated, and SQL metrics match the in-memory ones', async () => {
  const file = path.join(tmp(), 'brain.db');
  const sql = new Store(file);
  const mem = new Store(null);
  const bs = brainOn(sql);
  const bm = brainOn(mem);
  await scenario(bs);
  await scenario(bm);
  const vs = bs.valueReport('en').kpis;
  const vm = bm.valueReport('en').kpis;
  for (const k of ['crossAgentReuse', 'questionsSaved', 'leaksBlocked', 'handoffs', 'acceptanceRate']) assert.equal(vs[k], vm[k], k);
  assert.ok(vs.crossAgentReuse > 0 && vs.leaksBlocked > 0);
  assert.equal(sql.state.audit.length, 0, 'not kept in memory');
  const recent = bs.auditLog(5);
  assert.equal(recent.length, 5);
  assert.ok(recent[0].at >= recent[4].at, 'newest first');
  for (let i = 0; i < 6000; i++) sql.appendAudit({ at: i, op: 'read', agentId: 'atlas', sourceAgentId: 'kai', kind: 'episodic', itemId: `e${i}` });
  assert.ok(sql.auditAggregates(['kai', 'atlas']).total > 6000, 'no 5,000-row cap');
  sql.close();
});

test('legacy brain.json is imported once, then kept as a backup', async () => {
  const dir = tmp();
  const json = path.join(dir, 'brain.json');
  const mem = new Store(null);
  const b = brainOn(mem);
  await scenario(b);
  fs.writeFileSync(json, JSON.stringify(mem.state));
  const store = new Store(path.join(dir, 'brain.db'), { importFrom: json });
  assert.equal(store.state.facts.length, mem.state.facts.length);
  assert.equal(store.auditAggregates([]).total, mem.state.audit.length, 'audit rows imported');
  assert.ok(!fs.existsSync(json) && fs.existsSync(path.join(dir, 'brain.imported.bak.json')));
  store.close();
});

test('reset empties every table', async () => {
  const file = path.join(tmp(), 'brain.db');
  const store = new Store(file);
  await scenario(brainOn(store));
  store.reset();
  const info = store.info();
  assert.equal(info.rows.facts, 0);
  assert.equal(info.rows.audit, 0);
  assert.equal(info.rows.agents, emptyState().agents.length, 'default agents re-seeded');
  assert.equal(info.journal, 'wal');
  store.close();
});
