// Memory benchmark harness: scoring, scenario validation, and an end-to-end run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matches, scoreRecall, scoreSay } from '../bench/lib/score.mjs';
import { validateScenario, loadScenarios, parseDuration } from '../bench/lib/validate.mjs';
import { runScenario } from '../bench/lib/runner.mjs';
import { gate } from '../bench/lib/report.mjs';
import { InProcessTarget } from '../bench/lib/targets/inprocess.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = path.join(here, '..', 'bench', 'scenarios');
const AGENTS = ['mia', 'kai', 'atlas', 'sage', 'penny', 'nova'];

test('bench: text matching is case-insensitive, and "/re/flags" is a regex', () => {
  assert.ok(matches('Availability: No car for 3 days', 'no car for 3 days'));
  assert.ok(!matches('no car for 3 days', 'no bike'));
  assert.ok(matches('no vehicle for 3 days', '/no (car|vehicle)/'));
  assert.ok(!matches('NO CAR', '/no car/'), 'regex flags are respected');
  assert.ok(matches('NO CAR', '/no car/i'));
});

test('bench: recall checks feed the right metric', () => {
  const obs = {
    memories: [
      { text: 'availability: no car for 3 days', conflicted: false },
      { text: 'lives in: Can Tho', conflicted: true },
    ],
    promptBlock: '## Semantic memory\n- availability: no car for 3 days (from Kai, 1 day ago)',
  };
  const r = scoreRecall({ remembers: ['no car'], private: ['allerg'], stale: ['no car'], conflict: ['Can Tho', 'no car'] }, obs);
  const by = (type) => r.filter((c) => c.type === type).map((c) => c.passed);
  assert.deepEqual(by('remembers'), [true]);
  assert.deepEqual(by('private'), [true], 'absent private text passes');
  assert.deepEqual(by('stale'), [false], 'a stale fact still in context fails');
  assert.deepEqual(by('conflict'), [true, false], 'present but not flagged fails');

  const leak = scoreRecall({ private: ['from Kai'] }, obs);
  assert.equal(leak[0].passed, false, 'private text in the prompt block is a leak, even if not in memories');
});

test('bench: reply checks only count with an LLM', () => {
  const offline = scoreSay({ reply: { includes: ['window'], excludes: ['afraid'] } }, { reply: 'Window seat noted.' }, { llm: false });
  assert.ok(offline.every((c) => c.counted === false));
  const llm = scoreSay({ reply: { includes: ['window'], excludes: ['afraid'] } }, { reply: 'Window seat noted.' }, { llm: true });
  assert.deepEqual(llm.map((c) => [c.type, c.passed, c.counted]), [['reply', true, true], ['reply', true, true]]);
});

test('bench: durations', () => {
  assert.equal(parseDuration('45m'), 45 * 60_000);
  assert.equal(parseDuration('6h'), 6 * 3600_000);
  assert.equal(parseDuration('1.5d'), 1.5 * 86_400_000);
  assert.equal(parseDuration('3 days'), null);
});

test('bench: validation errors name the file and the step', () => {
  const bad = {
    id: 'x',
    category: 'nope',
    lang: 'en',
    steps: [
      { agent: 'kai', say: 'hello' },
      { advance: '3 days' },
      { agent: 'ghost', recall: 'hi' },
      { agent: 'atlas', recall: 'hi', expect: { remembers: 'not-an-array' } },
      { agent: 'atlas', say: 'hi', expect: { remembers: ['x'] } },
      { sleep: true, say: 'two kinds' },
    ],
  };
  const errs = validateScenario(bad, 'bad.json', { agents: AGENTS });
  const has = (re) => assert.ok(errs.some((e) => re.test(e)), `expected an error like ${re}\n${errs.join('\n')}`);
  has(/^bad\.json: category must be one of/);
  has(/^bad\.json: step 2: "advance" must look like/);
  has(/^bad\.json: step 3: unknown agent "ghost"/);
  has(/^bad\.json: step 4: expect\.remembers must be a list/);
  has(/^bad\.json: step 5: "remembers" is only allowed on recall steps/);
  has(/^bad\.json: step 6: a step must have exactly one of/);
  assert.deepEqual(validateScenario({ id: 'ok', category: 'stale', lang: 'en', steps: [{ agent: 'kai', say: 'hi' }] }, 'ok.json', { agents: AGENTS }), []);
});

test('bench: every bundled scenario is valid and ids are unique', () => {
  const { scenarios, errors } = loadScenarios(SCENARIOS, { agents: AGENTS });
  assert.deepEqual(errors, []);
  assert.ok(scenarios.length >= 12, `${scenarios.length} scenarios`);
  const cats = new Set(scenarios.map((s) => s.category));
  for (const c of ['cross_agent', 'stale', 'contradiction', 'leakage', 'multi_hop', 'long_conversation']) assert.ok(cats.has(c), `category ${c} is covered`);
  assert.ok(scenarios.some((s) => s.lang === 'vi') && scenarios.some((s) => s.lang === 'ja'));
});

test('bench: a scenario runs end to end through the in-process target', async () => {
  const scenario = {
    id: 'e2e',
    category: 'cross_agent',
    lang: 'en',
    steps: [
      { agent: 'kai', say: 'My car broke down, it will be in the shop for 3 days' },
      { advance: '1d' },
      { agent: 'atlas', recall: 'I need a flight to Da Nang next week', expect: { remembers: ['no car for 3 days'], private: ['allergic'] } },
      { advance: '4d' },
      { agent: 'atlas', recall: 'Book me a taxi to the airport', expect: { stale: ['no car for 3 days'], remembers: ['/never mentioned/'] } },
    ],
  };
  const r = await runScenario(scenario, () => new InProcessTarget({ lang: 'en' }));
  assert.equal(r.status, 'failed', 'one check is designed to fail');
  const checks = r.checks.map((c) => [c.type, c.passed]);
  assert.deepEqual(checks, [['remembers', true], ['private', true], ['remembers', false], ['stale', true]], 'checks are listed remembers → private → stale → conflict');
  const failed = r.checks.find((c) => !c.passed);
  assert.equal(failed.step, 5);
  assert.ok(r.timings.say.length === 1 && r.timings.recall.length === 2);
  assert.ok(r.promptTokens.length === 2 && r.promptTokens[0] > 0);
});

test('bench: a failed check is explained with the RAS reason when there is one', async () => {
  // The allergy is private to Sage's domain, so Atlas never sees it. Expecting
  // Atlas to remember it fails, and the report says why.
  const scenario = {
    id: 'diag',
    category: 'leakage',
    lang: 'en',
    steps: [
      { agent: 'sage', say: 'I am allergic to seafood' },
      { agent: 'atlas', recall: 'Book a hotel with a seafood buffet', expect: { remembers: ['seafood'] } },
    ],
  };
  const r = await runScenario(scenario, () => new InProcessTarget({ lang: 'en' }));
  const c = r.checks[0];
  assert.equal(c.passed, false);
  assert.match(c.reason || '', /private/, 'the failed remembers check carries the exclusion reason');
});

test('bench: a step that throws marks the scenario as an error and fails its checks', async () => {
  const scenario = { id: 'boom', category: 'stale', lang: 'en', steps: [{ agent: 'kai', say: 'hi' }, { agent: 'atlas', recall: 'x', expect: { remembers: ['a'], private: ['b'] } }] };
  const broken = () => {
    const t = new InProcessTarget({ lang: 'en' });
    t.recall = async () => {
      throw new Error('kaput');
    };
    return t;
  };
  const r = await runScenario(scenario, broken);
  assert.equal(r.status, 'error');
  assert.match(r.error, /step 2: kaput/);
  assert.equal(r.checks.length, 2);
  assert.ok(r.checks.every((c) => !c.passed));
});

test('bench: the CI gate fails on regressions and passes otherwise', () => {
  const m = (x = {}) => ({ metrics: { scenarioPassRate: 0.9, recallAccuracy: 0.9, leakRate: 0, staleUseRate: 0.25, conflictHandling: 1, recallP50: 0.5, promptTokens: 400, ...x } });
  assert.deepEqual(gate(m(), m()), [], 'same numbers pass');
  assert.deepEqual(gate(m({ recallAccuracy: 0.95, recallP50: 9, promptTokens: 900 }), m()), [], 'better numbers pass; latency and tokens are not gated');
  const v = gate(m({ recallAccuracy: 0.85, staleUseRate: 0.3, conflictHandling: 0.5 }), m());
  assert.deepEqual(v.map((x) => x.metric), ['recallAccuracy', 'staleUseRate', 'conflictHandling']);
  assert.match(v[0].message, /Recall accuracy dropped from 90\.0% to 85\.0%/);
  const leak = gate(m({ leakRate: 0.01 }), m());
  assert.equal(leak[0].metric, 'leakRate');
  assert.match(leak[0].message, /Leak rate must be 0/);
  assert.deepEqual(gate(m({ conflictHandling: null }), m({ conflictHandling: null })), [], 'metrics with no checks are skipped');
});
