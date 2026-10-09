// HTTP server: admin API (/api) for the hub UI, Brain API (/v1) for external
// agents, Server-Sent Events of brain activity, and the static visualizer.
// Zero web-framework dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain } from './brain/index.js';
import { factToText } from './brain/ontology.js';
import { Store } from './store.js';
import { NeuralBus } from './bus.js';
import { LLM } from './llm.js';
import { Embedder } from './embeddings.js';
import { SleepScheduler, sleepDefaultsFromEnv } from './brain/sleepScheduler.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const ADMIN_TOKEN = process.env.BRAIN_ADMIN_TOKEN || '';

const DB_FILE = process.env.BRAIN_DB || path.join(ROOT, 'data', 'brain.db');
const LEGACY_JSON = process.env.BRAIN_DATA || path.join(path.dirname(DB_FILE), 'brain.json'); // imported once if present
const SETTINGS_FILE = process.env.BRAIN_SETTINGS || path.join(path.dirname(DB_FILE), 'settings.json');
const store = new Store(DB_FILE, { importFrom: LEGACY_JSON });
const bus = new NeuralBus();
const llm = new LLM({ settingsFile: SETTINGS_FILE });
// Semantic search (opt-in). Without it the brain uses local hashing vectors.
const embedder = new Embedder({ settingsFile: SETTINGS_FILE, llm });
let brain = new Brain({ store, bus, llm, embedder });
// Automatic sleep (idle / pressure / nightly). Reads `brain` on every pass: reset replaces it.
const sleeper = new SleepScheduler(() => brain, { defaults: sleepDefaultsFromEnv(), intervalMs: Number(process.env.BRAIN_SLEEP_CHECK_SECONDS || 60) * 1000 });

const clients = new Set();
for (const ev of ['step', 'trace-start', 'trace-end', 'bus', 'conversation']) {
  bus.on(ev, (data) => {
    const msg = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw Object.assign(new Error('body too large'), { status: 413 });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

const q = (url, k) => url.searchParams.get(k);

// ---------- Admin API (hub UI) ----------
const admin = {
  'GET /api/state': (req, url) => ({ ...brain.snapshot(q(url, 'customerId') || 'kh-001', q(url, 'lang'), q(url, 'asOf')), hubRoot: ROOT, autoSleep: { enabled: sleeper.config.enabled, nextNightly: sleeper.nextNightly() } }),
  'GET /api/value': (req, url) => brain.valueReport(q(url, 'lang')),
  'GET /api/audit': (req, url) => brain.auditLog(Math.min(5000, Number(q(url, 'limit') || 100))),
  'GET /api/storage': () => store.info(),
  'POST /api/chat': async (req) => {
    const b = await readBody(req);
    return brain.think({ agentId: b.agentId, customerId: b.customerId || 'kh-001', text: b.text, lang: b.lang });
  },
  'POST /api/feedback': async (req) => brain.feedback(await readBody(req)),
  'POST /api/sleep': async (req) => {
    const b = await readBody(req);
    return brain.sleep({ customerId: b.customerId, lang: b.lang, trigger: 'manual' });
  },
  // Run one automatic-sleep pass now (operators; the HTTP benchmark target uses
  // it to reproduce what the scheduler does between requests).
  'POST /api/sleep/tick': async () => ({ runs: (await sleeper.tick()).map((r) => ({ customerId: r.customerId, trigger: r.trigger, consolidated: r.consolidated })) }),
  'GET /api/settings/sleep': () => sleeper.status(),
  'PUT /api/settings/sleep': async (req) => sleeper.configure(await readBody(req)),
  'POST /api/clock': async (req) => {
    const { days = 1 } = await readBody(req);
    return { now: brain.advanceClock(Number(days)) };
  },
  'POST /api/agents': async (req) => brain.createAgent(await readBody(req)),
  'POST /api/customers': async (req) => brain.createCustomer(await readBody(req)),
  'POST /api/customers/vip': async (req) => {
    const b = await readBody(req);
    return brain.setVip(b.customerId || 'kh-001', b.vip);
  },
  'POST /api/facts/resolve': async (req) => brain.resolveConflict((await readBody(req)).factId),
  'POST /api/facts/pin': async (req) => {
    const b = await readBody(req);
    return brain.pinFact(b.factId, b.pinned !== false);
  },
  'POST /api/skills/rollback': async (req) => brain.rollbackSkill((await readBody(req)).skillId),
  // LLM provider settings (API keys never leave the server)
  'GET /api/settings/llm': () => ({ config: llm.publicConfig(), providers: LLM.catalog() }),
  'PUT /api/settings/llm': async (req) => ({ config: llm.configure(await readBody(req)) }),
  'GET /api/settings/embeddings': () => ({ config: embedder.publicConfig(), providers: Embedder.catalog(), status: brain.embedQueue.status() }),
  'PUT /api/settings/embeddings': async (req) => {
    embedder.configure(await readBody(req));
    brain.embedQueue.kick(); // (re)index memories for the new model
    return { config: embedder.publicConfig(), status: brain.embedQueue.status() };
  },
  'POST /api/settings/embeddings/test': async (req) => {
    const b = await readBody(req);
    // Test the form as typed. The saved key is reused only for the same provider,
    // so switching provider never sends one vendor's key to another.
    const sameProvider = !b.provider || b.provider === embedder.provider;
    const draft = new Embedder({ config: { ...(embedder.cfg || {}), ...b, apiKey: b.apiKey || (sameProvider ? embedder.apiKey : '') }, llm });
    return draft.test();
  },
  'POST /api/settings/llm/test': async (req) => {
    const b = await readBody(req);
    return (b.provider ? llm.withConfig(b) : llm).test();
  },
  'POST /api/settings/llm/models': async (req) => {
    const b = await readBody(req);
    try {
      return { models: await (b.provider ? llm.withConfig(b) : llm).listModels() };
    } catch (e) {
      return { models: [], error: e.message.slice(0, 300) };
    }
  },
  'POST /api/reset': async () => {
    store.reset();
    brain.close();
    brain = new Brain({ store, bus, llm, embedder });
    store.flush();
    return { ok: true };
  },
};

// ---------- Brain API (external agents, Bearer <agent API key>) ----------
const v1 = {
  'GET /v1/me': (agent) => ({ id: agent.id, name: agent.name, domain: agent.domain, kind: agent.kind, permissions: agent.permissions }),
  'GET /v1/profile': (agent, req, url) => ({ customerId: q(url, 'customerId') || 'kh-001', facts: brain.profile(agent, q(url, 'customerId') || 'kh-001', q(url, 'lang')) }),
  'POST /v1/recall': async (agent, req) => {
    const b = await readBody(req);
    const r = await brain.recall({ agentId: agent.id, customerId: b.customerId, text: b.text, lang: b.lang, asOf: b.asOf ?? null });
    return b.includeSteps ? r : { ...r, steps: undefined };
  },
  'POST /v1/remember': async (agent, req) => {
    const b = await readBody(req);
    const r = await brain.remember({ agentId: agent.id, customerId: b.customerId, traceId: b.traceId, userText: b.userText, reply: b.reply, facts: b.facts, outcome: b.outcome, lang: b.lang });
    return b.includeSteps ? r : { ...r, steps: undefined };
  },
  'POST /v1/chat': async (agent, req) => {
    const b = await readBody(req);
    const r = await brain.think({ agentId: agent.id, customerId: b.customerId, text: b.text, lang: b.lang, via: 'api' });
    return { traceId: r.traceId, reply: r.reply, mode: r.mode, intent: r.intent.intent, suggestedActions: r.actions.map((a) => ({ id: a.id, label: a.label })), learned: r.learned };
  },
  'POST /v1/feedback': async (agent, req) => {
    const b = await readBody(req);
    const r = brain.feedback({ traceId: b.traceId, actionId: b.actionId, accepted: b.accepted, lang: b.lang, agentId: agent.id });
    return { ...r, steps: undefined };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    // --- Health check (no auth; used by Docker / load balancers) ---
    if (url.pathname === '/healthz') {
      return send(res, 200, { ok: true, version: VERSION, storage: store.backend, llm: llm.available ? llm.provider : 'offline' });
    }

    // --- Brain API for external agents ---
    if (url.pathname.startsWith('/v1/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
      }
      const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const agent = brain.agentByKey(key);
      if (!agent) return send(res, 401, { error: 'invalid or missing agent API key (Authorization: Bearer abk_…)' }, CORS);
      const handler = v1[`${req.method} ${url.pathname}`];
      if (!handler) return send(res, 404, { error: 'not found' }, CORS);
      return send(res, 200, await handler(agent, req, url), CORS);
    }

    // --- Admin API (optional token) ---
    if (url.pathname.startsWith('/api/')) {
      if (ADMIN_TOKEN) {
        const token = req.headers['x-admin-token'] || q(url, 'token');
        if (token !== ADMIN_TOKEN) return send(res, 401, { error: 'admin token required' });
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      const h = url.pathname.match(/^\/api\/facts\/([\w-]+)\/history$/);
      if (h && req.method === 'GET') {
        const lang = q(url, 'lang');
        return send(res, 200, { history: brain.factHistory(h[1]).map(({ embedding, vec, ...f }) => ({ ...f, text: factToText(f, lang || 'vi') })) });
      }
      const m = url.pathname.match(/^\/api\/agents\/([\w-]+)(\/rotate-key)?$/);
      if (m) {
        if (req.method === 'DELETE' && !m[2]) {
          brain.deleteAgent(m[1]);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'PATCH' && !m[2]) return send(res, 200, brain.updateAgent(m[1], await readBody(req)));
        if (req.method === 'POST' && m[2]) return send(res, 200, brain.rotateKey(m[1]));
      }
      const handler = admin[`${req.method} ${url.pathname}`];
      if (handler) return send(res, 200, await handler(req, url));
      return send(res, 404, { error: 'not found' });
    }

    // --- Static UI ---
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.message }, url.pathname.startsWith('/v1/') ? CORS : {});
  }
});

server.listen(PORT, HOST, () => {
  console.log(`🧠 Agent Brain Hub v${VERSION} → http://localhost:${PORT}`);
  console.log(`   Brain API for external agents → http://localhost:${PORT}/v1`);
  console.log(llm.available ? `   LLM: ${llm.label} (${llm.source})` : '   LLM: offline — pick a provider in the UI: Settings → Language model');
  console.log(`   Storage: SQLite ${DB_FILE}`);
  console.log(embedder.available ? `   Embeddings: ${embedder.modelId} (semantic search)` : '   Embeddings: local hashing — pick a model in Settings → Semantic search');
  brain.embedQueue.kick(); // index memories written before this model was configured
  if (ADMIN_TOKEN) console.log('   Admin API protected by BRAIN_ADMIN_TOKEN');
  const sc = sleeper.config;
  console.log(sc.enabled ? `   Auto sleep: after ${sc.idleMinutes} min idle or ${sc.maxPendingTurns} pending turns${sc.nightly ? `, nightly at ${sc.nightlyAt} (${sleeper.status().timeZone})` : ''}` : '   Auto sleep: off (Settings → Sleep cycle)');
  sleeper.start();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    sleeper.stop();
    brain.close();
    store.close();
    process.exit(0);
  });
}
