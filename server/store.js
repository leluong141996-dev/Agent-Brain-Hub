// Brain state persistence.
//
//  • SQLite (default when a file path is given): the in-memory `state` object
//    is a write-back cache; flush() writes only the rows that changed, inside
//    one transaction (WAL journal → crash-safe). Embeddings are stored as
//    Float32 BLOBs (exact; 1 KB per vector). The audit trail is written straight to its own table and
//    is never truncated; value metrics are computed with SQL over all of it.
//  • Memory (file = null): everything stays in RAM — used by unit tests.
//
// A legacy data/brain.json (schema v3) is imported automatically on first run.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_AGENTS } from './agents.js';
import { emptySleepState } from './brain/sleepScheduler.js';

// Bump when the schema changes incompatibly; older stores are backed up and replaced.
export const STATE_VERSION = 3;
const MEMORY_AUDIT_CAP = 5000;

export function emptyState() {
  return {
    version: STATE_VERSION,
    clockOffsetMs: 0,
    agents: DEFAULT_AGENTS.map((a) => ({ ...a, createdAt: Date.now() })),
    customers: { 'kh-001': { id: 'kh-001', name: 'Demo customer', vip: false } },
    working: {}, // Prefrontal: customerId → shared context
    episodes: [], // Neocortex episodic
    facts: [], // Neocortex semantic
    skills: [], // Cerebellum procedural
    patterns: {}, // Cerebellum: candidate task patterns awaiting promotion
    bandit: {}, // Basal ganglia: "action|intent" → {alpha, beta}
    insights: [], // DMN reflections
    traces: {}, // traceId → decision record (for feedback)
    audit: [], // memory backend only — SQLite keeps it in the `audit` table
    stats: { totals: {}, byAgent: {}, daily: {} }, // usage counters
    sleep: emptySleepState(), // automatic sleep: settings, nightly bookkeeping, recent runs
    relations: {}, // registry: core overrides + relations learned at runtime (v0.7)
    decisions: [], // arbitration decisions, newest last, capped (v0.7)
    trust: {}, // agentId → { up, down } (v0.7)
    seq: 0,
  };
}

// ---------------- SQLite schema ----------------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS working (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patterns (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bandit (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS insights (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS traces (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY, customer_id TEXT, relation TEXT, status TEXT, scope TEXT,
  owner_domain TEXT, source_agent_id TEXT, valid_until INTEGER, data TEXT NOT NULL, embedding BLOB, vec BLOB
);
CREATE INDEX IF NOT EXISTS facts_customer ON facts(customer_id, relation);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY, customer_id TEXT, kind TEXT, scope TEXT, agent_id TEXT,
  created_at INTEGER, expires_at INTEGER, data TEXT NOT NULL, embedding BLOB, vec BLOB
);
CREATE INDEX IF NOT EXISTS episodes_customer ON episodes(customer_id, created_at);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, op TEXT, agent_id TEXT, customer_id TEXT,
  trace_id TEXT, kind TEXT, item_id TEXT, relation TEXT, source_agent_id TEXT, scope TEXT, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_op ON audit(op);
CREATE INDEX IF NOT EXISTS audit_agents ON audit(source_agent_id, agent_id);
`;

// Vectors live in BLOB columns, not in the JSON `data`.
const noEmbedding = (k, v) => (k === 'embedding' || k === 'vec' ? undefined : v);
const toBlob = (vec) => (vec ? Buffer.from(new Float32Array(vec).buffer) : null);
const fromBlob = (buf) => (buf ? Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), (x) => Math.round(x * 1e4) / 1e4) : undefined);

// How each part of `state` maps onto a table.
const COLLECTIONS = [
  { table: 'agents', rows: (s) => s.agents, key: (r) => r.id },
  { table: 'customers', rows: (s) => Object.values(s.customers), key: (r) => r.id },
  { table: 'working', rows: (s) => Object.values(s.working), key: (r) => r.customerId },
  { table: 'skills', rows: (s) => s.skills, key: (r) => r.id },
  { table: 'patterns', rows: (s) => Object.values(s.patterns), key: (r) => r.key },
  { table: 'bandit', rows: (s) => Object.entries(s.bandit).map(([key, v]) => ({ key, ...v })), key: (r) => r.key },
  { table: 'insights', rows: (s) => s.insights, key: (r) => `${r.customerId}|${r.at}|${r.text}` },
  { table: 'traces', rows: (s) => Object.values(s.traces), key: (r) => r.traceId },
  {
    table: 'facts',
    rows: (s) => s.facts,
    key: (r) => r.id,
    cols: ['customer_id', 'relation', 'status', 'scope', 'owner_domain', 'source_agent_id', 'valid_until'],
    values: (r) => [r.customerId, r.relation, r.status, r.scope, r.ownerDomain, r.sourceAgentId, r.validUntil ?? null],
    embedding: true,
  },
  {
    table: 'episodes',
    rows: (s) => s.episodes,
    key: (r) => r.id,
    cols: ['customer_id', 'kind', 'scope', 'agent_id', 'created_at', 'expires_at'],
    values: (r) => [r.customerId, r.kind, r.scope, r.agentId, r.createdAt ?? null, r.expiresAt ?? null],
    embedding: true,
  },
];

export class Store {
  /**
   * @param {string|null} file   SQLite database path, or null for in-memory
   * @param {object} [opts]
   * @param {string} [opts.importFrom]  legacy brain.json to import into an empty database
   */
  constructor(file = null, { importFrom = null } = {}) {
    this.file = file;
    this.state = emptyState();
    this._timer = null;
    this.lastFlush = { upserts: 0, deletes: 0, ms: 0 };
    if (!file) {
      this.backend = 'memory';
      return;
    }
    this.backend = 'sqlite';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = this.open(file);
    const version = this.meta('version');
    if (version && Number(version) !== STATE_VERSION) {
      this.db.close();
      const backup = `${file}.v${version}.bak`;
      fs.renameSync(file, backup);
      console.warn(`[store] database schema v${version} is outdated → moved to ${backup}, starting fresh`);
      this.db = this.open(file);
    }
    this.prepare();
    this.snap = new Map(COLLECTIONS.map((c) => [c.table, new Map()]));
    if (this.meta('version')) this.load();
    else if (importFrom && fs.existsSync(importFrom)) this.importJson(importFrom);
    else this.flush(); // persist the seeded state
  }

  open(file) {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('journal_size_limit = 16777216'); // truncate the WAL back to ≤16 MB after checkpoints
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    // Columns added after a release are added in place: changing STATE_VERSION
    // would move the whole database aside.
    for (const table of ['facts', 'episodes']) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!cols.includes('vec')) db.exec(`ALTER TABLE ${table} ADD COLUMN vec BLOB`);
    }
    return db;
  }

  prepare() {
    const db = this.db;
    this.stmt = {
      meta: db.prepare('SELECT value FROM meta WHERE key = ?'),
      setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      audit: db.prepare(`INSERT INTO audit (at, op, agent_id, customer_id, trace_id, kind, item_id, relation, source_agent_id, scope, data)
        VALUES (@at, @op, @agentId, @customerId, @traceId, @kind, @itemId, @relation, @sourceAgentId, @scope, @data)`),
    };
    for (const c of COLLECTIONS) {
      const cols = c.cols || [];
      const vecCols = c.embedding ? ['embedding', 'vec'] : [];
      const all = ['id', ...cols, 'data', ...vecCols];
      const update = [...cols, 'data', ...vecCols].map((x) => `${x} = excluded.${x}`).join(', ');
      c.upsert = db.prepare(`INSERT INTO ${c.table} (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${update}`);
      c.del = db.prepare(`DELETE FROM ${c.table} WHERE id = ?`);
      c.select = db.prepare(`SELECT * FROM ${c.table} ORDER BY rowid`);
    }
  }

  meta(key) {
    return this.stmt ? this.stmt.meta.get(key)?.value : this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
  }

  // ---------------- load ----------------
  load() {
    const s = emptyState();
    const read = (c) =>
      c.select.all().map((row) => {
        const obj = JSON.parse(row.data);
        if (c.embedding) {
          obj.embedding = fromBlob(row.embedding);
          if (row.vec) obj.vec = fromBlob(row.vec);
        }
        this.snap.get(c.table).set(row.id, row.data);
        return obj;
      });
    const by = Object.fromEntries(COLLECTIONS.map((c) => [c.table, read(c)]));
    s.agents = by.agents;
    s.customers = Object.fromEntries(by.customers.map((r) => [r.id, r]));
    s.working = Object.fromEntries(by.working.map((r) => [r.customerId, r]));
    s.skills = by.skills;
    s.patterns = Object.fromEntries(by.patterns.map((r) => [r.key, r]));
    s.bandit = Object.fromEntries(by.bandit.map(({ key, ...v }) => [key, v]));
    s.insights = by.insights;
    s.traces = Object.fromEntries(by.traces.map((r) => [r.traceId, r]));
    s.facts = by.facts;
    s.episodes = by.episodes;
    s.clockOffsetMs = Number(this.meta('clockOffsetMs') || 0);
    s.seq = Number(this.meta('seq') || 0);
    s.stats = JSON.parse(this.meta('stats') || '{"totals":{},"byAgent":{},"daily":{}}');
    s.sleep = { ...emptySleepState(), ...JSON.parse(this.meta('sleep') || '{}') };
    s.relations = JSON.parse(this.meta('relations') || '{}');
    s.decisions = JSON.parse(this.meta('decisions') || '[]');
    s.trust = JSON.parse(this.meta('trust') || '{}');
    s.audit = [];
    this.state = s;
  }

  importJson(file) {
    try {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (loaded.version !== STATE_VERSION) {
        console.warn(`[store] ${file} has schema v${loaded.version || 1}; not imported`);
        return this.flush();
      }
      this.state = { ...emptyState(), ...loaded };
      const audit = this.state.audit || [];
      this.state.audit = [];
      this.db.transaction(() => {
        for (const e of audit) this.insertAudit(e);
      })();
      this.flush();
      fs.renameSync(file, file.replace(/\.json$/, '.imported.bak.json'));
      console.log(`[store] imported ${file} into ${this.file} (${this.state.facts.length} facts, ${this.state.episodes.length} episodes, ${audit.length} audit rows)`);
    } catch (e) {
      console.warn('[store] JSON import failed, starting fresh:', e.message);
      this.flush();
    }
  }

  id(prefix) {
    this.state.seq += 1;
    return `${prefix}-${this.state.seq.toString(36)}`;
  }

  // ---------------- write-back ----------------
  save() {
    if (this.backend !== 'sqlite') return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }

  // Write the rows that changed since the last flush, in one transaction.
  flush() {
    if (this.backend !== 'sqlite') return this.lastFlush;
    clearTimeout(this._timer);
    const t0 = performance.now();
    let upserts = 0;
    let deletes = 0;
    this.db.transaction(() => {
      for (const c of COLLECTIONS) {
        const snap = this.snap.get(c.table);
        const seen = new Set();
        for (const row of c.rows(this.state)) {
          const id = c.key(row);
          seen.add(id);
          const json = JSON.stringify(row, noEmbedding);
          if (snap.get(id) === json) continue;
          const args = [id, ...(c.values ? c.values(row) : []), json];
          if (c.embedding) args.push(toBlob(row.embedding), toBlob(row.vec));
          c.upsert.run(...args);
          snap.set(id, json);
          upserts += 1;
        }
        for (const id of snap.keys()) {
          if (seen.has(id)) continue;
          c.del.run(id);
          snap.delete(id);
          deletes += 1;
        }
      }
      this.stmt.setMeta.run('version', String(STATE_VERSION));
      this.stmt.setMeta.run('clockOffsetMs', String(this.state.clockOffsetMs || 0));
      this.stmt.setMeta.run('seq', String(this.state.seq || 0));
      this.stmt.setMeta.run('stats', JSON.stringify(this.state.stats || {}));
      this.stmt.setMeta.run('sleep', JSON.stringify(this.state.sleep || emptySleepState()));
      this.stmt.setMeta.run('relations', JSON.stringify(this.state.relations || {}));
      this.stmt.setMeta.run('decisions', JSON.stringify(this.state.decisions || []));
      this.stmt.setMeta.run('trust', JSON.stringify(this.state.trust || {}));
    })();
    this.lastFlush = { upserts, deletes, ms: +(performance.now() - t0).toFixed(1) };
    return this.lastFlush;
  }

  reset() {
    // Data is wiped; the automatic-sleep settings are configuration, so they stay.
    const sleepConfig = this.state.sleep?.config || null;
    this.state = emptyState();
    this.state.sleep.config = sleepConfig;
    if (this.backend !== 'sqlite') return;
    this.db.transaction(() => {
      for (const c of COLLECTIONS) this.db.prepare(`DELETE FROM ${c.table}`).run();
      this.db.prepare('DELETE FROM audit').run();
      this.db.prepare("DELETE FROM sqlite_sequence WHERE name = 'audit'").run();
    })();
    for (const m of this.snap.values()) m.clear();
    this.flush();
  }

  close() {
    if (this.backend !== 'sqlite') return;
    this.flush();
    this.db.close();
  }

  // ---------------- audit trail ----------------
  insertAudit(e) {
    this.stmt.audit.run({
      at: e.at ?? null,
      op: e.op ?? null,
      agentId: e.agentId ?? null,
      customerId: e.customerId ?? null,
      traceId: e.traceId ?? null,
      kind: e.kind ?? null,
      itemId: e.itemId ?? null,
      relation: e.relation ?? null,
      sourceAgentId: e.sourceAgentId ?? null,
      scope: e.scope ?? null,
      data: JSON.stringify(e),
    });
  }

  appendAudit(entry) {
    if (this.backend === 'sqlite') return this.insertAudit(entry);
    const log = (this.state.audit ||= []);
    log.push(entry);
    if (log.length > MEMORY_AUDIT_CAP) log.splice(0, log.length - MEMORY_AUDIT_CAP);
  }

  recentAudit(limit = 100) {
    if (this.backend !== 'sqlite') return (this.state.audit || []).slice(-limit).reverse();
    return this.db
      .prepare('SELECT data FROM audit ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map((r) => JSON.parse(r.data));
  }

  // Aggregates behind the business-value report, over the whole audit trail.
  //   pairs: read counts grouped by (writer agent, reader agent)
  //   crossSemanticDistinct: distinct facts read across agents (per trace)
  //   blocked: reads stopped by scope / permissions
  auditAggregates(agentIds = []) {
    const valid = new Set(agentIds);
    if (this.backend !== 'sqlite') {
      const log = this.state.audit || [];
      const pairs = new Map();
      const distinct = new Set();
      let blocked = 0;
      for (const e of log) {
        if (e.op === 'blocked') blocked += 1;
        if (e.op !== 'read') continue;
        const k = `${e.sourceAgentId ?? ''}|${e.agentId}`;
        pairs.set(k, (pairs.get(k) || 0) + 1);
        if (e.kind === 'semantic' && e.sourceAgentId && e.sourceAgentId !== e.agentId && valid.has(e.sourceAgentId)) distinct.add(`${e.traceId}|${e.itemId}`);
      }
      return {
        pairs: [...pairs].map(([k, n]) => {
          const [source, reader] = k.split('|');
          return { source: source || null, reader, n };
        }),
        crossSemanticDistinct: distinct.size,
        blocked,
        total: log.length,
      };
    }
    const pairs = this.db
      .prepare("SELECT source_agent_id AS source, agent_id AS reader, COUNT(*) AS n FROM audit WHERE op = 'read' GROUP BY source_agent_id, agent_id")
      .all();
    const ids = [...valid];
    const crossSemanticDistinct = ids.length
      ? this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM (SELECT DISTINCT trace_id, item_id FROM audit
             WHERE op = 'read' AND kind = 'semantic' AND source_agent_id IS NOT NULL AND source_agent_id != agent_id
             AND source_agent_id IN (${ids.map(() => '?').join(',')}))`
          )
          .get(...ids).n
      : 0;
    const blocked = this.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE op = 'blocked'").get().n;
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
    return { pairs, crossSemanticDistinct, blocked, total };
  }

  // ---------------- diagnostics ----------------
  info() {
    if (this.backend !== 'sqlite') return { backend: 'memory' };
    this.flush();
    const size = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
    const rows = Object.fromEntries(['agents', 'customers', 'facts', 'episodes', 'skills', 'traces', 'audit'].map((t) => [t, this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
    return {
      backend: 'sqlite',
      path: this.file,
      sizeBytes: size(this.file) + size(`${this.file}-wal`),
      journal: this.db.pragma('journal_mode', { simple: true }),
      sqliteVersion: this.db.prepare('SELECT sqlite_version() AS v').get().v,
      rows,
      lastFlush: this.lastFlush,
    };
  }
}
