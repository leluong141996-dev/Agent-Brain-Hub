// Automatic sleep cycle: idle, pressure and nightly triggers, settings, persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { SleepScheduler, SLEEP_DEFAULTS, normalizeSleepConfig, sleepDefaultsFromEnv } from '../server/brain/sleepScheduler.js';

const MIN = 60_000;
const makeBrain = (store = new Store(null)) => new Brain({ store, bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const at = (s) => new Date(s); // local time

// A scheduler on a fake wall clock that the test moves by hand.
function setup({ config, time = '2026-10-07T10:00' } = {}) {
  const b = makeBrain();
  const wall = { now: at(time) };
  const s = new SleepScheduler(() => b, { now: () => wall.now });
  if (config) s.configure(config);
  return { b, s, wall };
}

const chat = (b, n, customerId = 'kh-001') =>
  (async () => {
    for (let i = 0; i < n; i++) await b.think({ agentId: 'atlas', customerId, text: `I need a flight to Da Nang, question ${i}`, lang: 'en' });
  })();

test('settings: validated, and environment variables only set defaults', () => {
  assert.deepEqual(normalizeSleepConfig({}), SLEEP_DEFAULTS);
  assert.throws(() => normalizeSleepConfig({ idleMinutes: 2 }), /idleMinutes/);
  assert.throws(() => normalizeSleepConfig({ maxPendingTurns: 40 }), /maxPendingTurns/, 'must stay below the working-memory cap');
  assert.throws(() => normalizeSleepConfig({ nightlyAt: '25:00' }), /HH:MM/);
  assert.equal(normalizeSleepConfig({ idleMinutes: '45' }).idleMinutes, 45, 'form strings are accepted');

  const env = sleepDefaultsFromEnv({ BRAIN_SLEEP_AUTO: '0', BRAIN_SLEEP_IDLE_MINUTES: '10', BRAIN_SLEEP_NIGHTLY_AT: 'off' });
  assert.equal(env.enabled, false);
  assert.equal(env.idleMinutes, 10);
  assert.equal(env.nightly, false);

  const { s } = setup();
  const s2 = new SleepScheduler(s.getBrain, { defaults: env });
  assert.equal(s2.config.enabled, false, 'env default applies until something is saved');
  s2.configure({ enabled: true });
  assert.equal(s2.config.enabled, true, 'saved settings win over env');
  assert.equal(s2.config.idleMinutes, 10, 'unchanged fields keep their value');
});

test('idle: a quiet conversation is consolidated once, after the idle time', async () => {
  const { b, s } = setup();
  await chat(b, 2);
  assert.deepEqual(await s.tick(), [], 'still talking → no sleep');
  assert.equal(s.pending()[0].turns, 4);

  b.advanceClock(29 / 1440);
  assert.deepEqual(await s.tick(), [], '29 minutes is not enough');

  b.advanceClock(2 / 1440);
  const runs = await s.tick();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger, 'idle');
  assert.ok(runs[0].consolidated >= 1, 'the session became an episode');
  assert.equal(s.pending().length, 0);
  assert.deepEqual(await s.tick(), [], 'nothing left → no second sleep');
  assert.equal(b.state.sleep.history[0].trigger, 'idle');
});

test('pressure: consolidates before working memory starts dropping turns', async () => {
  const { b, s } = setup({ config: { maxPendingTurns: 12 } });
  await chat(b, 5); // 10 turns
  assert.deepEqual(await s.tick(), []);
  await chat(b, 1); // 12 turns
  const runs = await s.tick();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger, 'pressure');
});

test('without the scheduler, a long conversation still loses no turns: the cap forces a sleep', async () => {
  // Working memory holds 40 turns. Before, the 41st turn evicted the oldest
  // one even if it had never reached long-term memory. Now the cap only
  // evicts consolidated turns and asks the brain to sleep.
  const b = makeBrain();
  await chat(b, 30);
  await b.idle();
  const wm = b.state.working['kh-001'];
  assert.ok(wm.turns.length <= 40 + 2, 'working memory stays bounded');
  const sessions = b.state.episodes.filter((e) => e.kind === 'session');
  assert.ok(b.state.sleep.history.some((h) => h.trigger === 'pressure'), 'the cap triggered a sleep');
  const consolidatedTurns = sessions.reduce((n, e) => n + e.turnCount, 0);
  const pendingTurns = wm.turns.filter((x) => !x.consolidated).length;
  assert.equal(consolidatedTurns + pendingTurns, 60, 'every turn reached long-term memory or is still pending');
  assert.ok(sessions.some((e) => /question 0\b/.test(e.text)), 'the first question was consolidated, not dropped');

  const { b: b2, s } = setup();
  for (let i = 0; i < 30; i++) {
    await chat(b2, 1);
    await s.tick();
  }
  const sessions2 = b2.state.episodes.filter((e) => e.kind === 'session');
  const total = sessions2.reduce((n, e) => n + e.turnCount, 0) + b2.state.working['kh-001'].turns.filter((x) => !x.consolidated).length;
  assert.equal(total, 60, 'with the scheduler too');
});

test('burst: turns that arrive while sleep waits on a slow summarizer are not lost', async () => {
  // Suggested by @ahmetozel on daily.dev: 8 messages while the summarizer
  // takes 300 ms. Before the fix, 10 of 26 turns never reached long-term memory.
  const llm = new LLM({ offline: true });
  llm.summarize = async () => {
    await new Promise((r) => setTimeout(r, 300));
    return 'summary';
  };
  const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm, deterministic: true });
  await chat(b, 5);
  const sleeping = b.sleep({ customerId: 'kh-001', lang: 'en', trigger: 'pressure' });
  await new Promise((r) => setTimeout(r, 20));
  await chat(b, 8);
  await sleeping;
  const wm = b.state.working['kh-001'];
  assert.equal(wm.turns.filter((x) => !x.consolidated).length, 16, 'all 8 exchanges during sleep are still pending');
  await b.sleep({ customerId: 'kh-001', lang: 'en', trigger: 'idle' });
  const covered = b.state.episodes.filter((e) => e.kind === 'session').reduce((n, e) => n + e.turnCount, 0);
  assert.equal(covered, 26, 'every turn reached long-term memory');
});

test('disabled: no automatic sleep at all', async () => {
  const { b, s } = setup({ config: { enabled: false } });
  await chat(b, 2);
  b.advanceClock(1);
  assert.deepEqual(await s.tick(), []);
  assert.equal(s.nextNightly(), null);
});

test('nightly: runs once a day at the set time, only for customers active since', async () => {
  const { b, s, wall } = setup({ config: { idleMinutes: 1440, nightlyAt: '03:00' }, time: '2026-10-07T10:00' });
  assert.deepEqual(await s.tick(), [], 'first start after 03:00 → first night is tomorrow');
  assert.equal(new Date(s.nextNightly()).getDate(), 8);

  await chat(b, 1, 'kh-001');
  b.createCustomer({ name: 'Quiet customer' });

  wall.now = at('2026-10-08T02:59');
  assert.deepEqual(await s.tick(), []);
  wall.now = at('2026-10-08T03:00');
  const runs = await s.tick();
  assert.deepEqual(runs.map((r) => [r.customerId, r.trigger]), [['kh-001', 'nightly']]);
  wall.now = at('2026-10-08T05:00');
  assert.deepEqual(await s.tick(), [], 'once per night');
  wall.now = at('2026-10-09T03:30');
  assert.deepEqual(await s.tick(), [], 'no activity since last night → nothing to do');
});

test('nightly: first start before the set time sleeps the same night', async () => {
  const { b, s, wall } = setup({ config: { idleMinutes: 1440, nightlyAt: '03:00' }, time: '2026-10-07T01:00' });
  await s.tick();
  await chat(b, 1);
  wall.now = at('2026-10-07T03:05');
  assert.equal((await s.tick()).length, 1);
});

test('manual and automatic sleeps never overlap', async () => {
  const b = makeBrain();
  await chat(b, 2);
  const events = [];
  b.bus.on('trace-start', (e) => e.kind === 'sleep' && events.push('start'));
  b.bus.on('trace-end', (e) => e.kind === 'sleep' && events.push('end'));
  const [a, z] = await Promise.all([b.sleep({ trigger: 'manual' }), b.sleep({ trigger: 'idle' })]);
  assert.deepEqual(events, ['start', 'end', 'start', 'end']);
  assert.equal(a.trigger, 'manual');
  assert.equal(z.trigger, 'idle');
  assert.deepEqual(b.state.sleep.history.map((h) => h.trigger), ['idle', 'manual'], 'newest first');
});

test('sleep settings and history survive a restart; reset keeps the settings', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-sleep-')), 'brain.db');
  const s1 = new Store(file);
  const b1 = makeBrain(s1);
  new SleepScheduler(() => b1).configure({ idleMinutes: 45, nightlyAt: '02:30' });
  await chat(b1, 1);
  await b1.sleep({ trigger: 'manual' });
  s1.close();

  const s2 = new Store(file);
  const b2 = makeBrain(s2);
  const sched = new SleepScheduler(() => b2);
  assert.equal(sched.config.idleMinutes, 45);
  assert.equal(sched.config.nightlyAt, '02:30');
  assert.equal(b2.state.sleep.history[0].trigger, 'manual');

  s2.reset();
  assert.equal(new SleepScheduler(() => makeBrain(s2)).config.idleMinutes, 45, 'settings kept');
  assert.equal(s2.state.sleep.history.length, 0, 'history wiped with the data');
  s2.close();
});
