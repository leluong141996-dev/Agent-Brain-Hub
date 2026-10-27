#!/usr/bin/env node
// Compare saved benchmark results on the scenarios they all ran, counting
// only the checks every system can be scored on (no `conflict` checks: they
// look for the hub's conflict flag).
//   node bench/compare.mjs bench/results/A.json bench/results/B.json ...
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (files.length < 2) {
  console.error('usage: node bench/compare.mjs <result.json> <result.json> [...]');
  process.exit(1);
}
const runs = files.map((f) => ({ name: path.basename(f, '.json'), ...JSON.parse(fs.readFileSync(f, 'utf8')) }));
const common = runs.map((r) => new Set(r.scenarios.map((s) => s.id))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
const counted = (c) => c.counted && c.type !== 'conflict';

function score(run) {
  const sc = run.scenarios.filter((s) => common.has(s.id));
  const checks = sc.flatMap((s) => s.checks.filter(counted));
  const of = (t) => checks.filter((c) => c.type === t);
  const ok = (s) => s.status !== 'error' && s.checks.filter(counted).every((c) => c.passed);
  const pass = (xs) => [xs.filter((c) => c.passed).length, xs.length];
  const fail = (xs) => [xs.filter((c) => !c.passed).length, xs.length];
  const cats = {};
  for (const s of sc) (cats[s.category] ||= [0, 0]), (cats[s.category][0] += ok(s)), (cats[s.category][1] += 1);
  return { scenarios: [sc.filter(ok).length, sc.length], recall: pass(of('remembers')), leak: fail(of('private')), poison: fail(of('poison')), stale: fail(of('stale')), cats };
}
const pct = ([n, d]) => (d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : '—');
const scores = runs.map(score);
const head = `| ${common.size} common scenarios | ${runs.map((r) => r.mode).join(' | ')} |`;
const rows = [
  ['Scenarios passed', 'scenarios'],
  ['Recall (remembers checks)', 'recall'],
  ['Leak rate (private data to the wrong agent)', 'leak'],
  ['Poison rate (planted text reaching an agent)', 'poison'],
  ['Stale-use rate', 'stale'],
];
console.log(head);
console.log(`|---|${runs.map(() => '---').join('|')}|`);
for (const [label, k] of rows) console.log(`| ${label} | ${scores.map((s) => pct(s[k])).join(' | ')} |`);
const cats = [...new Set(scores.flatMap((s) => Object.keys(s.cats)))].sort();
console.log(`\n| Category | ${runs.map((r) => r.name).join(' | ')} |\n|---|${runs.map(() => '---').join('|')}|`);
for (const c of cats) console.log(`| ${c} | ${scores.map((s) => (s.cats[c] ? `${s.cats[c][0]}/${s.cats[c][1]}` : '—')).join(' | ')} |`);
