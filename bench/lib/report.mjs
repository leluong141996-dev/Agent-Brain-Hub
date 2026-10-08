// Metrics, markdown tables and the JSON result.
import { CATEGORIES } from './validate.mjs';

const ratio = (n, d) => (d ? n / d : null);
const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const ms = (x) => (x === null || x === undefined ? '—' : `${x.toFixed(1)} ms`);
const num = (x) => (x === null || x === undefined ? '—' : x.toFixed(0));

function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function metricsOf(results) {
  const checks = results.flatMap((r) => r.checks.filter((c) => c.counted));
  const of = (type) => checks.filter((c) => c.type === type);
  const passed = (xs) => xs.filter((c) => c.passed).length;
  const say = results.flatMap((r) => r.timings.say);
  const recall = results.flatMap((r) => r.timings.recall);
  const tokens = results.flatMap((r) => r.promptTokens);
  return {
    scenarios: results.length,
    scenarioPassRate: ratio(results.filter((r) => r.status === 'passed').length, results.length),
    recallAccuracy: ratio(passed(of('remembers')), of('remembers').length),
    leakRate: ratio(of('private').length - passed(of('private')), of('private').length),
    staleUseRate: ratio(of('stale').length - passed(of('stale')), of('stale').length),
    conflictHandling: ratio(passed(of('conflict')), of('conflict').length),
    replyAccuracy: ratio(passed(of('reply')), of('reply').length),
    sayP50: quantile(say, 0.5),
    sayP95: quantile(say, 0.95),
    recallP50: quantile(recall, 0.5),
    recallP95: quantile(recall, 0.95),
    promptTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) / tokens.length : null,
  };
}

export function summarize(results, meta) {
  const categories = {};
  for (const c of CATEGORIES) {
    const rs = results.filter((r) => r.category === c);
    if (rs.length) categories[c] = metricsOf(rs);
  }
  return {
    ...meta,
    metrics: metricsOf(results),
    categories,
    scenarios: results.map((r) => ({
      id: r.id,
      category: r.category,
      lang: r.lang,
      status: r.status,
      error: r.error,
      checks: r.checks.map(({ type, pattern, passed, counted, step, reason }) => ({ type, pattern, passed, counted, step, ...(reason ? { reason } : {}) })),
    })),
  };
}

// [label, key, formatter, higherIsBetter]
const ROWS = [
  ['Scenario pass rate', 'scenarioPassRate', pct, true],
  ['Recall accuracy', 'recallAccuracy', pct, true],
  ['Leak rate', 'leakRate', pct, false],
  ['Stale-use rate', 'staleUseRate', pct, false],
  ['Conflict handling', 'conflictHandling', pct, true],
  ['Reply accuracy (LLM)', 'replyAccuracy', pct, true],
  ['say p50 / p95', ['sayP50', 'sayP95'], ms, false],
  ['recall p50 / p95', ['recallP50', 'recallP95'], ms, false],
  ['Prompt tokens (mean)', 'promptTokens', num, false],
];

function delta(cur, base, fmt, higherIsBetter) {
  if (cur === null || base === null || cur === undefined || base === undefined) return '';
  const d = cur - base;
  if (Math.abs(d) < 1e-9) return '=';
  const better = higherIsBetter ? d > 0 : d < 0;
  const shown = fmt === pct ? `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)} pp` : `${d > 0 ? '+' : ''}${fmt(d)}`;
  if (/^[+-]?0(\.0+)?( ms| pp)?$/.test(shown)) return '='; // below display precision
  return `${better ? '▲' : '▼'} ${shown}`;
}

export function markdown(summary, base = null) {
  const m = summary.metrics;
  const b = base?.metrics;
  const lines = [];
  lines.push(`### Memory benchmark: ${summary.version} (${summary.mode}, ${m.scenarios} scenarios)`, '');
  lines.push(b ? `| Metric | Value | vs ${base.version} |` : '| Metric | Value |', b ? '|---|---|---|' : '|---|---|');
  for (const [label, key, fmt, hib] of ROWS) {
    if (key === 'replyAccuracy' && m.replyAccuracy === null) continue;
    const val = Array.isArray(key) ? key.map((k) => fmt(m[k])).join(' / ') : fmt(m[key]);
    const d = b ? (Array.isArray(key) ? delta(m[key[0]], b[key[0]], fmt, hib) : delta(m[key], b[key], fmt, hib)) : null;
    lines.push(b ? `| ${label} | ${val} | ${d} |` : `| ${label} | ${val} |`);
  }
  lines.push('', '| Category | Scenarios | Passed | Recall | Leak | Stale use | Conflict |', '|---|---|---|---|---|---|---|');
  for (const [c, x] of Object.entries(summary.categories)) {
    lines.push(`| ${c} | ${x.scenarios} | ${pct(x.scenarioPassRate)} | ${pct(x.recallAccuracy)} | ${pct(x.leakRate)} | ${pct(x.staleUseRate)} | ${pct(x.conflictHandling)} |`);
  }
  const failed = summary.scenarios.filter((s) => s.status !== 'passed');
  if (failed.length) {
    lines.push('', '#### Failures', '');
    for (const s of failed) {
      lines.push(`- **${s.id}** (${s.category}, ${s.lang})${s.error ? `: error at ${s.error}` : ''}`);
      for (const c of s.checks.filter((x) => x.counted && !x.passed)) {
        lines.push(`  - step ${c.step}, \`${c.type}\` ${JSON.stringify(c.pattern)}${c.reason ? ` (excluded: ${c.reason})` : ''}`);
      }
    }
  }
  return lines.join('\n');
}

// CI gate: quality metrics must not get worse than the baseline. Latency and
// prompt tokens depend on the machine and on deliberate trade-offs, so they're
// reported but not gated. A tiny tolerance absorbs floating-point noise.
const GATED = [
  ['scenarioPassRate', 'Scenario pass rate', true],
  ['recallAccuracy', 'Recall accuracy', true],
  ['staleUseRate', 'Stale-use rate', false],
  ['conflictHandling', 'Conflict handling', true],
  ['replyAccuracy', 'Reply accuracy', true],
];
const EPS = 1e-9;

export function gate(summary, base) {
  const m = summary.metrics;
  const b = base.metrics;
  const out = [];
  if (m.leakRate !== null && m.leakRate > 0) {
    out.push({ metric: 'leakRate', message: `Leak rate must be 0, got ${pct(m.leakRate)}: private data reached an agent that must not see it.` });
  }
  for (const [key, label, higherIsBetter] of GATED) {
    if (m[key] === null || m[key] === undefined || b[key] === null || b[key] === undefined) continue;
    const worse = higherIsBetter ? m[key] < b[key] - EPS : m[key] > b[key] + EPS;
    if (worse) out.push({ metric: key, message: `${label} ${higherIsBetter ? 'dropped' : 'rose'} from ${pct(b[key])} to ${pct(m[key])}.` });
  }
  return out;
}
