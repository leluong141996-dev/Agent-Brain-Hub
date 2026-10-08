#!/usr/bin/env node
// Retrieval benchmark on LongMemEval (MIT, Wu et al. 2024): does retrieval put
// the sessions that hold the answer at the top?
//
// For each question, a fresh brain stores the ~50 haystack sessions verbatim as
// episodes (with their real dates; the brain's clock is set to the question
// date), then RAS ranks them for the question. We report recall@k at session
// level: "any" = at least one evidence session in the top k, "all" = every one.
// This measures retrieval only, not fact extraction or answer quality.
//
//   npm run bench:longmemeval -- --download              fetch the dataset (277 MB, into data/datasets/)
//   npm run bench:longmemeval                            all questions, local hashing
//   npm run bench:longmemeval -- --embed --limit 50      with the configured embedding model
//   npm run bench:longmemeval -- --save                  writes bench/results/<version>-longmemeval[-embed-…].json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { Embedder } from '../server/embeddings.js';
import { addEpisode } from '../server/brain/neocortex.js';
import { retrieve } from '../server/brain/ras.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, def) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : def;
};
const URL_ = 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json';
const FILE = path.resolve(opt('file', path.join(root, 'data', 'datasets', 'longmemeval_s_cleaned.json')));
const KS = [1, 4, 10];

if (flag('download')) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  console.error(`Downloading LongMemEval-S (MIT) → ${path.relative(root, FILE)} …`);
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  fs.writeFileSync(FILE, Buffer.from(await res.arrayBuffer()));
}
if (!fs.existsSync(FILE)) {
  console.error(`Dataset not found at ${path.relative(root, FILE)}. Run: npm run bench:longmemeval -- --download`);
  process.exit(1);
}

// "2023/05/30 (Tue) 23:40" → ms
const parseDate = (s) => {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}).*?(\d{2}):(\d{2})/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
};
const sessionText = (turns) => turns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n');

let embedder = null;
if (flag('embed')) {
  embedder = new Embedder({ settingsFile: process.env.BRAIN_SETTINGS || path.join(root, 'data', 'settings.json') });
  if (!embedder.available) {
    console.error('--embed: no embedding model is configured (Settings → Semantic search, or BRAIN_EMBED_*).');
    process.exit(1);
  }
}

const all = JSON.parse(fs.readFileSync(FILE, 'utf8'));
// Abstention questions have no evidence session; they are not a retrieval task.
let questions = all.filter((q) => !q.question_id.endsWith('_abs') && q.answer_session_ids?.length);
const types = opt('types');
if (types) questions = questions.filter((q) => types.split(',').includes(q.question_type));
const limit = Number(opt('limit', 0));
if (limit) questions = questions.slice(0, limit);

const rows = [];
const started = performance.now();
for (const [n, q] of questions.entries()) {
  const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true, embedder });
  const asked = parseDate(q.question_date);
  b.clock.offsetMs = asked - Date.now();
  const agent = b.state.agents.find((a) => a.id === 'mia');
  q.haystack_sessions.forEach((turns, i) => {
    const at = parseDate(q.haystack_dates[i]);
    addEpisode(b, { customerId: 'user', agentId: 'mia', ownerDomain: 'personal', scope: 'shared', kind: 'session', text: sessionText(turns), createdAt: at, lastAccess: at, sessionId: q.haystack_session_ids[i] });
  });
  if (embedder) await b.embedQueue.drain({ throwOnError: true });

  const t0 = performance.now();
  const qvec = await b.queryVector(q.question);
  const t = b.bus.trace('bench', { lang: 'en' });
  const r = retrieve(b, t, { customerId: 'user', agent, query: q.question, intent: 'general', qvec, budgetTokens: Infinity, maxEpisodes: Math.max(...KS), maxFacts: 0 });
  const ms = performance.now() - t0;
  const ranked = r.selected.filter((s) => s.kind === 'episodic').map((s) => b.state.episodes.find((e) => e.id === s.id)?.sessionId);
  const evidence = new Set(q.answer_session_ids);
  const at = Object.fromEntries(KS.map((k) => {
    const top = new Set(ranked.slice(0, k));
    const hits = [...evidence].filter((id) => top.has(id)).length;
    return [k, { any: hits > 0, all: hits === evidence.size }];
  }));
  rows.push({ id: q.question_id, type: q.question_type, ms, at });
  b.close();
  if ((n + 1) % 50 === 0) process.stderr.write(`${n + 1}/${questions.length} `);
}
process.stderr.write(`\n${((performance.now() - started) / 1000).toFixed(1)} s\n\n`);

const rate = (xs, k, kind) => (xs.length ? xs.filter((x) => x.at[k][kind]).length / xs.length : null);
const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const summarise = (xs) => Object.fromEntries(KS.flatMap((k) => [[`any@${k}`, rate(xs, k, 'any')], [`all@${k}`, rate(xs, k, 'all')]]));
const byType = {};
for (const ty of [...new Set(rows.map((r) => r.type))].sort()) byType[ty] = { questions: rows.filter((r) => r.type === ty).length, ...summarise(rows.filter((r) => r.type === ty)) };
const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const summary = {
  dataset: 'LongMemEval-S (cleaned), session-level retrieval',
  version: pkg.version,
  date: new Date().toISOString(),
  mode: embedder ? `hybrid: ${embedder.modelId} + hashing` : 'hashing',
  questions: rows.length,
  overall: summarise(rows),
  byType,
  retrievalP50ms: +lat[Math.floor(lat.length / 2)].toFixed(2),
};

const head = `| | ${KS.map((k) => `any@${k}`).join(' | ')} | ${KS.map((k) => `all@${k}`).join(' | ')} |`;
const sep = `|---|${KS.map(() => '---|').join('')}${KS.map(() => '---|').join('')}`;
const line = (label, s) => `| ${label} | ${KS.map((k) => pct(s[`any@${k}`])).join(' | ')} | ${KS.map((k) => pct(s[`all@${k}`])).join(' | ')} |`;
console.log(`### LongMemEval-S retrieval: ${summary.version} (${summary.mode}, ${rows.length} questions)\n`);
console.log([head, sep, line('**Overall**', summary.overall), ...Object.entries(byType).map(([ty, s]) => line(`${ty} (${s.questions})`, s))].join('\n'));
console.log(`\nRetrieval p50: ${summary.retrievalP50ms} ms per question (${q50sessions(questions)} sessions).`);

function q50sessions(qs) {
  const n = qs.map((q) => q.haystack_sessions.length).sort((a, b) => a - b);
  return n[Math.floor(n.length / 2)];
}

if (flag('save')) {
  const slug = embedder ? `-embed-${embedder.modelId.replace(/[^a-z0-9.]+/gi, '-')}` : '';
  const file = path.join(here, 'results', `${pkg.version}-longmemeval${slug}${limit ? `-first${limit}` : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
  console.log(`\nSaved ${path.relative(root, file)}`);
}
