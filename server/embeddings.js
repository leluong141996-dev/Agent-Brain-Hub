// Embedding providers for semantic retrieval. Opt-in: without a configured
// provider the brain keeps using its local feature-hashing vectors (embed.js).
// Every provider speaks the OpenAI-compatible POST {baseUrl}/embeddings API.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { embed, cosine } from './embed.js';

export const EMBED_PROVIDERS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', model: 'text-embedding-3-small', needsKey: true },
  gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', model: '', needsKey: true },
  ollama: { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'bge-m3', needsKey: false, local: true },
  vllm: { label: 'vLLM', baseUrl: 'http://localhost:8000/v1', model: '', needsKey: false, local: true },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: '', needsKey: false, local: true },
  custom: { label: 'Custom', baseUrl: '', keyEnv: 'BRAIN_EMBED_API_KEY', model: '', needsKey: false },
};

const BATCH = 32;
const PARAPHRASES = ['My car is in the shop for repairs.', 'The vehicle is being fixed at the garage.'];

// Only BRAIN_EMBED_PROVIDER turns embeddings on from the environment; a vendor
// key alone (OPENAI_API_KEY…) must not start sending memory to a new service.
export function embedConfigFromEnv(env = process.env) {
  const provider = env.BRAIN_EMBED_PROVIDER;
  if (!provider || provider === 'off' || !EMBED_PROVIDERS[provider]) return null;
  const p = EMBED_PROVIDERS[provider];
  return {
    provider,
    baseUrl: env.BRAIN_EMBED_BASE_URL || p.baseUrl,
    model: env.BRAIN_EMBED_MODEL || p.model,
    apiKey: env.BRAIN_EMBED_API_KEY || '',
  };
}

function normalise(v) {
  const n = Math.hypot(...v) || 1;
  return Float32Array.from(v, (x) => x / n);
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export class Embedder {
  /**
   * @param {object} [opts]
   * @param {string} [opts.settingsFile]  UI settings (key `embeddings`), shared with the LLM settings
   * @param {object} [opts.config]        explicit config (tests, benchmark)
   * @param {object} [opts.llm]           LLM, to reuse its key when the vendor is the same
   * @param {object} [opts.env]
   */
  constructor({ settingsFile = null, config, llm = null, env = process.env } = {}) {
    this.settingsFile = settingsFile;
    this.llm = llm;
    this.env = env;
    this.lastError = null;
    let cfg = config;
    this.source = config ? 'config' : null;
    if (cfg === undefined && settingsFile && fs.existsSync(settingsFile)) {
      try {
        cfg = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).embeddings;
        if (cfg) this.source = 'settings';
      } catch {}
    }
    if (!cfg && config === undefined) {
      cfg = embedConfigFromEnv(env);
      if (cfg) this.source = 'env';
    }
    this.cfg = cfg ? this.normalise(cfg) : null;
  }

  normalise(input, base = {}) {
    const provider = input.provider ?? base.provider;
    if (provider === 'off' || !provider) return null;
    if (!EMBED_PROVIDERS[provider]) throw Object.assign(new Error(`unknown embedding provider "${provider}"`), { status: 400 });
    const p = EMBED_PROVIDERS[provider];
    const switched = provider !== base.provider;
    return {
      provider,
      baseUrl: String(input.baseUrl ?? (switched ? p.baseUrl : base.baseUrl) ?? '').replace(/\/$/, ''),
      model: String(input.model ?? (switched ? p.model : base.model) ?? '').trim(),
      apiKey: input.apiKey !== undefined && input.apiKey !== '' ? String(input.apiKey) : switched ? '' : base.apiKey || '',
      timeoutMs: Number(input.timeoutMs ?? base.timeoutMs ?? 1500),
    };
  }

  configure(input, { persist = true } = {}) {
    this.cfg = this.normalise(input, this.cfg || {});
    this.source = 'settings';
    this.lastError = null;
    if (persist) this.save();
    return this.publicConfig();
  }

  save() {
    if (!this.settingsFile) return;
    let data = {};
    try {
      if (fs.existsSync(this.settingsFile)) data = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
    } catch {}
    data.embeddings = this.cfg ? { ...this.cfg } : { provider: 'off' };
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  get provider() {
    return this.cfg?.provider || null;
  }

  get apiKey() {
    if (!this.cfg) return '';
    const p = EMBED_PROVIDERS[this.cfg.provider];
    if (this.cfg.apiKey) return this.cfg.apiKey;
    if (p.keyEnv && this.env[p.keyEnv]) return this.env[p.keyEnv];
    if (this.llm && this.llm.provider === this.cfg.provider) return this.llm.apiKey || '';
    return '';
  }

  get available() {
    if (!this.cfg || !this.cfg.baseUrl || !this.cfg.model) return false;
    return !EMBED_PROVIDERS[this.cfg.provider].needsKey || !!this.apiKey;
  }

  get modelId() {
    return this.available ? `${this.cfg.provider}:${this.cfg.model}` : null;
  }

  publicConfig() {
    const key = this.apiKey;
    return {
      provider: this.cfg?.provider || 'off',
      label: this.cfg ? EMBED_PROVIDERS[this.cfg.provider].label : 'Hashing (offline)',
      baseUrl: this.cfg?.baseUrl || '',
      model: this.cfg?.model || '',
      hasKey: !!key,
      keyHint: key ? `••••${key.slice(-4)}` : '',
      available: this.available,
      modelId: this.modelId,
      source: this.source,
      lastError: this.lastError,
    };
  }

  static catalog() {
    return Object.entries(EMBED_PROVIDERS).map(([id, p]) => ({ id, ...p }));
  }

  // Returns one unit-length Float32Array per text. Throws on any error.
  async embedBatch(texts, { timeoutMs = 30_000 } = {}) {
    if (!this.available) throw new Error('embeddings are not configured');
    const out = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const chunk = texts.slice(i, i + BATCH);
      const headers = { 'content-type': 'application/json' };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const res = await fetch(`${this.cfg.baseUrl}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.cfg.model, input: chunk }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`${res.status} ${body?.error?.message || body?.error || res.statusText}`.trim());
      const data = Array.isArray(body?.data) ? [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : null;
      if (!data || data.length !== chunk.length) throw new Error('unexpected response: wrong number of embeddings');
      for (const d of data) {
        if (!Array.isArray(d.embedding) || !d.embedding.length) throw new Error('unexpected response: missing embedding');
        if (out.length && d.embedding.length !== out[0].length) throw new Error('unexpected response: dimensions differ');
        out.push(normalise(d.embedding));
      }
    }
    return out;
  }

  // For retrieval: never throws. `vec` is null when off, slow or failing.
  async embedQuery(text) {
    if (!this.available) return { vec: null, model: null, status: 'off' };
    try {
      const [vec] = await this.embedBatch([text], { timeoutMs: this.cfg.timeoutMs });
      this.lastError = null;
      return { vec, model: this.modelId, status: 'ok' };
    } catch (e) {
      const status = e.name === 'TimeoutError' || /aborted|timeout/i.test(e.message) ? `fallback (timeout ${this.cfg.timeoutMs} ms)` : `fallback (${e.message})`;
      this.lastError = e.message;
      return { vec: null, model: this.modelId, status };
    }
  }

  // Settings → Test: dimensions, latency, and how close two paraphrases are.
  async test() {
    const t0 = performance.now();
    try {
      const [a, b] = await this.embedBatch(PARAPHRASES, { timeoutMs: 30_000 });
      const hashing = +Math.max(0, cosine(embed(PARAPHRASES[0]), embed(PARAPHRASES[1]))).toFixed(3);
      return { ok: true, dims: a.length, ms: Math.round(performance.now() - t0), similarity: +dot(a, b).toFixed(3), hashing, pair: PARAPHRASES };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}
