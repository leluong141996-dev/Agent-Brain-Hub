// HTTP target: runs scenarios against a running hub over its public APIs, so
// the benchmark can score a Docker deployment, a server with its own LLM and
// embedding settings, or (later) be driven by Argus.
//
// Black-box and non-destructive: each scenario gets its own customer id, and
// each scenario agent ("kai", "atlas"…) becomes a temporary *connected* agent
// with the same domain, deleted afterwards. Built-in agents and their keys are
// never touched. Note that `advance` moves the hub's simulated clock, which is
// global: point this at a test hub, not production.
import { DEFAULT_AGENTS } from '../../../server/agents.js';

const DAY = 86_400_000;
const DOMAIN = Object.fromEntries(DEFAULT_AGENTS.map((a) => [a.id, a.domain]));
let seq = 0;

export class HttpTarget {
  constructor({ url, token = '', lang = 'en', scenarioId = 'scenario', run = Date.now().toString(36) }) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.lang = lang;
    this.base = `bench-${run}-${scenarioId}-${++seq}`;
    this.agents = new Map(); // scenario agent id → { id, key }
  }

  async call(method, path, body, key) {
    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    else if (this.token) headers['x-admin-token'] = this.token;
    const res = await fetch(this.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || res.statusText}`);
    return data;
  }

  customer(name) {
    return name ? `${this.base}-${name}` : this.base;
  }

  async agent(id) {
    if (!this.agents.has(id)) {
      const domain = DOMAIN[id];
      if (!domain) throw new Error(`unknown agent "${id}"`);
      const r = await this.call('POST', '/api/agents', { name: `${this.base} ${id}`, domain, kind: 'external' });
      this.agents.set(id, { id: r.agent.id, key: r.apiKey });
    }
    return this.agents.get(id);
  }

  async say(agent, text, customer) {
    const a = await this.agent(agent);
    const r = await this.call('POST', '/v1/chat', { customerId: this.customer(customer), text, lang: this.lang }, a.key);
    return { reply: r.reply, learned: r.learned };
  }

  async recall(agent, text, customer) {
    const a = await this.agent(agent);
    const r = await this.call('POST', '/v1/recall', { customerId: this.customer(customer), text, lang: this.lang }, a.key);
    return { memories: r.memories, promptBlock: r.promptBlock };
  }

  async advance(ms) {
    await this.call('POST', '/api/clock', { days: ms / DAY });
    await this.settle();
  }

  async sleep(customer) {
    await this.call('POST', '/api/sleep', { customerId: this.customer(customer), lang: this.lang });
    await this.settle();
  }

  // What the hub does between requests: one automatic-sleep pass and, when
  // embeddings are on, indexing new memories.
  async settle() {
    await this.call('POST', '/api/sleep/tick');
    for (let i = 0; i < 600; i++) {
      const e = await this.call('GET', '/api/settings/embeddings');
      if (!e.config.available || e.status.done >= e.status.total) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('embedding backfill did not finish within 60 s');
  }

  async close() {
    for (const a of this.agents.values()) await this.call('DELETE', `/api/agents/${a.id}`).catch(() => {});
  }
}
