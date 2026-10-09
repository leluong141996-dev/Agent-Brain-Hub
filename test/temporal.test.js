// v0.5: memory that is correct over time — validity, invalidation instead of
// deletion, history retention, and read-only recall({ asOf }).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { stateAt, visibleAt, normalizeFact } from '../server/brain/temporal.js';

const DAY = 86_400_000;
const makeBrain = (store = new Store(null)) => new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const fact = (b, re) => b.state.facts.find((f) => re.test(f.value));

test('temporal: stateAt follows recording, validity, invalidation and conflicts', () => {
  const f = { recordedAt: 100, validFrom: 100, validUntil: 500, invalidatedAt: null, conflictedAt: 200, conflictResolvedAt: 300 };
  assert.equal(stateAt(f, 50), 'unknown', 'not recorded yet');
  assert.equal(stateAt(f, 150), 'active');
  assert.equal(stateAt(f, 250), 'conflicted');
  assert.equal(stateAt(f, 350), 'active', 'conflict resolved');
  assert.equal(stateAt(f, 600), 'expired');
  assert.equal(stateAt({ ...f, pinned: true }, 600), 'active', 'pinned facts never expire');
  assert.equal(stateAt({ ...f, invalidatedAt: 400, invalidReason: 'superseded' }, 450), 'superseded');
  assert.equal(stateAt({ ...f, invalidatedAt: 400, invalidReason: 'resolved' }, 450), 'resolved');
  assert.ok(visibleAt(f, 250) && visibleAt(f, 150) && !visibleAt(f, 600) && !visibleAt(f, 50));
});

test('temporal: legacy facts are normalised on load', () => {
  const old = normalizeFact({ createdAt: 10, updatedAt: 20, status: 'superseded' });
  assert.equal(old.recordedAt, 10);
  assert.equal(old.validFrom, 10);
  assert.equal(old.invalidatedAt, 20);
  assert.equal(old.invalidReason, 'superseded');
  const c = normalizeFact({ createdAt: 10, updatedAt: 30, status: 'conflicted' });
  assert.equal(c.conflictedAt, 30);
});

test('temporal: an update invalidates the old fact instead of deleting it, and keeps the chain', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  b.advanceClock(10);
  await b.think({ agentId: 'mia', text: 'I moved to Saigon last month', lang: 'en' });
  const hanoi = fact(b, /Hanoi/);
  const saigon = fact(b, /Saigon/);
  assert.ok(hanoi, 'the old fact is still stored');
  assert.equal(hanoi.invalidatedBy, saigon.id);
  assert.equal(hanoi.invalidReason, 'superseded');
  assert.equal(stateAt(hanoi, b.clock.now()), 'superseded');
  assert.deepEqual(b.factHistory(saigon.id).map((f) => f.value), ['Hanoi', 'Saigon']);
});

test('temporal: resolving a conflict invalidates the loser with reason "resolved"', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I live in Da Nang', lang: 'en' });
  const [h, d] = [fact(b, /Hanoi/), fact(b, /Da Nang/)];
  assert.ok(h.conflictedAt && d.conflictedAt);
  b.advanceClock(1);
  b.resolveConflict(d.id);
  const now = b.clock.now();
  assert.equal(stateAt(d, now), 'active');
  assert.equal(stateAt(h, now), 'resolved');
  assert.equal(stateAt(h, now - DAY / 2), 'conflicted', 'before the resolution it was a conflict');
});

test('temporal: an expired fact is no longer a live competitor for new facts', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'kai', text: 'My car broke down, it will be in the shop for 3 days', lang: 'en' });
  b.advanceClock(10);
  const r = await b.think({ agentId: 'kai', text: 'My car broke down again, it will be in the shop for 5 days', lang: 'en' });
  assert.ok(!r.learned.some((l) => l.action === 'conflict'), JSON.stringify(r.learned));
});

test('temporal: sleep purges ended facts only after historyDays; 0 restores the old behaviour', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'kai', text: 'My car broke down, it will be in the shop for 3 days', lang: 'en' });
  b.advanceClock(10);
  await b.sleep();
  assert.ok(fact(b, /no car/), 'expired 6 days ago: kept as history');
  b.advanceClock(90);
  await b.sleep();
  assert.ok(!fact(b, /no car/), 'purged after 90 days');

  const b0 = makeBrain();
  b0.state.sleep.config = { historyDays: 0 };
  await b0.think({ agentId: 'kai', text: 'My car broke down, it will be in the shop for 3 days', lang: 'en' });
  b0.advanceClock(10);
  await b0.sleep();
  assert.ok(!fact(b0, /no car/), 'historyDays 0 deletes at once');
});

test('temporal: recall({ asOf }) returns what the brain believed then, and writes nothing', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  b.advanceClock(1);
  const before = b.clock.now();
  b.advanceClock(1);
  await b.think({ agentId: 'mia', text: 'I moved to Saigon last month', lang: 'en' });

  const snapshot = JSON.stringify({ facts: b.state.facts, episodes: b.state.episodes, working: b.state.working });
  const past = await b.recall({ agentId: 'atlas', text: 'Book a taxi from my home', lang: 'en', asOf: before });
  const now = await b.recall({ agentId: 'atlas', text: 'Book a taxi from my home', lang: 'en', asOf: b.clock.now() });
  assert.equal(JSON.stringify({ facts: b.state.facts, episodes: b.state.episodes, working: b.state.working }), snapshot, 'read-only');
  assert.ok(past.memories.some((m) => /Hanoi/.test(m.text)) && !past.memories.some((m) => /Saigon/.test(m.text)), 'past belief');
  assert.ok(now.memories.some((m) => /Saigon/.test(m.text)) && !now.memories.some((m) => /lives in: Hanoi/.test(m.text)), 'current belief');
  assert.equal(past.asOf, before);
});

test('temporal: looking at the past never widens permissions', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'sage', text: 'I am allergic to peanuts', lang: 'en' });
  b.advanceClock(1);
  const r = await b.recall({ agentId: 'atlas', text: 'peanut allergy', lang: 'en', asOf: b.clock.now() });
  assert.ok(!r.memories.some((m) => /peanut/.test(m.text)));
});

test('temporal: the new fields survive a restart', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-temporal-')), 'brain.db');
  const s1 = new Store(file);
  const b1 = makeBrain(s1);
  await b1.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b1.think({ agentId: 'mia', text: 'I moved to Saigon', lang: 'en' });
  s1.close();
  const s2 = new Store(file);
  const h = s2.state.facts.find((f) => /Hanoi/.test(f.value));
  assert.equal(h.invalidReason, 'superseded');
  assert.ok(h.recordedAt && h.invalidatedAt && h.invalidatedBy);
  s2.close();
});
