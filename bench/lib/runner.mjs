// Runs one scenario against a target and scores every check.
import { performance } from 'node:perf_hooks';
import { scoreRecall, scoreSay, matches } from './score.mjs';
import { parseDuration } from './validate.mjs';
import { estimateTokens } from '../../server/text.js';

// The checks a step would produce, all failed (used when a scenario errors).
function failedChecks(st, n) {
  const empty = { memories: [], promptBlock: '', reply: '' };
  const all = st.recall !== undefined ? scoreRecall(st.expect, empty) : st.say !== undefined ? scoreSay(st.expect, empty, { llm: true }) : [];
  return all.map((c) => ({ ...c, passed: false, step: n }));
}

// Why a memory wasn't there, when the target can tell (in-process only).
function explain(c, obs) {
  if (c.passed || !['remembers', 'conflict'].includes(c.type)) return c;
  const hit = obs.diagnostics?.excluded?.find((x) => matches(x.text, c.pattern));
  return hit ? { ...c, reason: hit.reason } : c;
}

export async function runScenario(s, makeTarget, { llm = false } = {}) {
  const res = { id: s.id, category: s.category, lang: s.lang, file: s.file, status: 'passed', error: null, checks: [], timings: { say: [], recall: [] }, promptTokens: [] };
  const target = makeTarget(s);
  let n = 0;
  try {
    for (const st of s.steps) {
      n += 1;
      if (st.say !== undefined) {
        const t0 = performance.now();
        const obs = await target.say(st.agent, st.say, st.customer);
        res.timings.say.push(performance.now() - t0);
        await target.settle?.();
        res.checks.push(...scoreSay(st.expect, obs, { llm }).map((c) => ({ ...c, step: n })));
      } else if (st.recall !== undefined) {
        const t0 = performance.now();
        const obs = await target.recall(st.agent, st.recall, st.customer);
        res.timings.recall.push(performance.now() - t0);
        res.promptTokens.push(estimateTokens(obs.promptBlock));
        res.checks.push(...scoreRecall(st.expect, obs).map((c) => ({ ...explain(c, obs), step: n })));
      } else if (st.advance !== undefined) {
        await target.advance(parseDuration(st.advance));
      } else if (st.sleep) {
        await target.sleep(st.customer);
      }
    }
  } catch (e) {
    res.status = 'error';
    res.error = `step ${n}: ${e.message}`;
    // An errored scenario must not look good: every check counts as failed.
    res.checks = res.checks.map((c) => ({ ...c, passed: false }));
    s.steps.slice(n - 1).forEach((st, i) => res.checks.push(...failedChecks(st, n + i)));
  } finally {
    await target.close?.();
  }
  if (res.status !== 'error') res.status = res.checks.filter((c) => c.counted).every((c) => c.passed) ? 'passed' : 'failed';
  return res;
}
