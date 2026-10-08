#!/usr/bin/env node
// Memory benchmark for Agent Brain Hub. See bench/README.md.
//   npm run bench
//   npm run bench -- --filter leakage --compare bench/results/0.2.0.json
//   npm run bench -- --llm --save
//   npm run bench -- --embed          (configured embedding model; Settings → Semantic search or BRAIN_EMBED_*)
//   npm run bench -- --gate bench/results/0.3.0.json   (CI: exit 1 if a quality metric got worse)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AGENTS } from '../server/agents.js';
import { LLM } from '../server/llm.js';
import { Embedder } from '../server/embeddings.js';
import { loadScenarios } from './lib/validate.mjs';
import { runScenario } from './lib/runner.mjs';
import { InProcessTarget } from './lib/targets/inprocess.mjs';
import { summarize, markdown, gate } from './lib/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const agents = DEFAULT_AGENTS.map((a) => a.id);
const { scenarios: all, errors } = loadScenarios(path.join(here, 'scenarios'), { agents });
if (errors.length) {
  console.error(`Invalid scenario files:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}
const filter = opt('filter');
const scenarios = filter ? all.filter((s) => s.category === filter || s.id === filter) : all;
if (!scenarios.length) {
  console.error(`No scenario matches --filter ${filter}`);
  process.exit(1);
}

let llm = null;
const usage = { calls: 0, ms: 0 };
if (flag('llm')) {
  llm = new LLM({ settingsFile: process.env.BRAIN_SETTINGS || path.join(root, 'data', 'settings.json') });
  if (!llm.available) {
    console.error('--llm: no language model is configured. Pick one in the UI (Settings → Language model) or set BRAIN_LLM_* / a provider key.');
    process.exit(1);
  }
  const call = llm._call.bind(llm);
  llm._call = async (o) => {
    const t0 = performance.now();
    usage.calls += 1;
    try {
      return await call(o);
    } finally {
      usage.ms += performance.now() - t0;
    }
  };
}

let embedder = null;
if (flag('embed')) {
  embedder = new Embedder({ settingsFile: process.env.BRAIN_SETTINGS || path.join(root, 'data', 'settings.json'), llm });
  if (!embedder.available) {
    console.error('--embed: no embedding model is configured. Pick one in the UI (Settings → Semantic search) or set BRAIN_EMBED_PROVIDER / BRAIN_EMBED_MODEL.');
    process.exit(1);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let commit = null;
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {}

const results = [];
const started = performance.now();
for (const s of scenarios) {
  const r = await runScenario(s, (sc) => new InProcessTarget({ lang: sc.lang, llm, embedder }), { llm: !!llm });
  results.push(r);
  process.stderr.write(r.status === 'passed' ? '.' : r.status === 'error' ? 'E' : 'F');
}
process.stderr.write(` ${((performance.now() - started) / 1000).toFixed(1)} s\n\n`);

const summary = summarize(results, {
  version: pkg.version,
  commit,
  date: new Date().toISOString(),
  mode: [llm ? `llm: ${llm.label}` : 'offline', embedder ? `embeddings: ${embedder.modelId}` : 'hashing'].join(', '),
  node: process.version,
  ...(llm ? { llmUsage: { calls: usage.calls, seconds: +(usage.ms / 1000).toFixed(1) } } : {}),
});
const compare = opt('compare');
const base = compare ? JSON.parse(fs.readFileSync(path.resolve(compare), 'utf8')) : null;
console.log(markdown(summary, base));
if (llm) console.log(`\nLLM: ${usage.calls} calls, ${(usage.ms / 1000).toFixed(1)} s`);

const gateFile = opt('gate');
if (gateFile) {
  const baseline = JSON.parse(fs.readFileSync(path.resolve(gateFile), 'utf8'));
  if (baseline.mode !== summary.mode) {
    console.error(`\n--gate: ${gateFile} was measured in mode "${baseline.mode}", this run is "${summary.mode}". Compare like with like.`);
    process.exit(1);
  }
  if (filter) {
    console.error('\n--gate needs the full scenario set; drop --filter.');
    process.exit(1);
  }
  const violations = gate(summary, baseline);
  if (violations.length) {
    console.error(`\n✗ Benchmark gate failed against ${baseline.version} (${path.relative(root, path.resolve(gateFile))}):`);
    for (const v of violations) console.error(`  - ${v.message}`);
    console.error('\nIf the change is intended (for example a scenario that now expects better behaviour), re-save the baseline with --save and explain it in the PR.');
    process.exitCode = 1;
  } else {
    console.log(`\n✓ Benchmark gate passed against ${baseline.version}.`);
  }
}

if (flag('save')) {
  const suffix = `${llm ? '-llm' : ''}${embedder ? `-embed-${embedder.modelId.replace(/[^a-z0-9.]+/gi, '-')}` : ''}`;
  const file = path.join(here, 'results', `${pkg.version}${suffix}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
  console.log(`\nSaved ${path.relative(root, file)}`);
}
