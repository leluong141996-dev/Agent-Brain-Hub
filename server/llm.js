// Language cortex: generation / extraction / summarization / reflection.
//
// Providers (see PROVIDERS):
//   • anthropic      — Claude via the official Anthropic SDK
//   • openai-compat  — every other provider speaks the OpenAI Chat Completions
//                      protocol: OpenAI GPT, Google Gemini (OpenAI endpoint),
//                      DeepSeek, Mistral, Groq, xAI, OpenRouter, Together,
//                      Ollama, vLLM, LM Studio, or any custom endpoint.
//   • offline        — no LLM: deterministic rule-based / template path.
//
// Configuration comes from the hub UI (persisted in a settings file) and
// falls back to environment variables. It can be changed at runtime with
// configure() — no restart needed. Provider quirks (max_completion_tokens,
// no temperature, no JSON mode, unknown extra params…) are learned
// automatically from 400 responses and remembered for the session.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { RELATIONS } from './brain/ontology.js';
import { LANGUAGE_NAME, normLang } from './i18n.js';

const TIMEOUT_MS = Number(process.env.BRAIN_LLM_TIMEOUT_MS || 60_000);

// Suggested models are only placeholders — the UI can fetch the live model
// list from the provider (GET /models), which is the source of truth.
export const PROVIDERS = {
  anthropic: { label: 'Claude', vendor: 'Anthropic', kind: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-opus-5-5', utility: 'claude-haiku-4-5', needsKey: true, docs: 'https://docs.anthropic.com' },
  openai: { label: 'GPT', vendor: 'OpenAI', kind: 'openai-compat', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', model: 'gpt-5-mini', needsKey: true, quirks: { maxTokensParam: 'max_completion_tokens', noExtras: true } },
  gemini: { label: 'Gemini', vendor: 'Google', kind: 'openai-compat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', model: 'gemini-2.5-flash', needsKey: true, quirks: { noExtras: true } },
  deepseek: { label: 'DeepSeek', vendor: 'DeepSeek', kind: 'openai-compat', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', needsKey: true, quirks: { noExtras: true } },
  mistral: { label: 'Mistral', vendor: 'Mistral AI', kind: 'openai-compat', baseUrl: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest', needsKey: true, quirks: { noExtras: true } },
  groq: { label: 'Groq', vendor: 'Groq', kind: 'openai-compat', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile', needsKey: true, quirks: { noExtras: true } },
  xai: { label: 'Grok', vendor: 'xAI', kind: 'openai-compat', baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY', model: 'grok-4', needsKey: true, quirks: { noExtras: true } },
  openrouter: { label: 'OpenRouter', vendor: 'OpenRouter', kind: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', model: 'openai/gpt-5-mini', needsKey: true, quirks: { noExtras: true } },
  together: { label: 'Together', vendor: 'Together AI', kind: 'openai-compat', baseUrl: 'https://api.together.xyz/v1', keyEnv: 'TOGETHER_API_KEY', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', needsKey: true, quirks: { noExtras: true } },
  ollama: { label: 'Ollama', vendor: 'Local', kind: 'openai-compat', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b', needsKey: false, local: true },
  vllm: { label: 'vLLM', vendor: 'Local', kind: 'openai-compat', baseUrl: 'http://localhost:8000/v1', model: 'qwen3-4b', needsKey: false, local: true },
  lmstudio: { label: 'LM Studio', vendor: 'Local', kind: 'openai-compat', baseUrl: 'http://localhost:1234/v1', model: 'local-model', needsKey: false, local: true },
  custom: { label: 'Custom', vendor: 'OpenAI-compatible', kind: 'openai-compat', baseUrl: '', keyEnv: 'BRAIN_LLM_API_KEY', model: '', needsKey: false },
  offline: { label: 'Offline', vendor: 'Rules + templates', kind: 'offline', needsKey: false },
};

// Tolerant JSON parse: whole string, else the outermost {...} / [...] span.
function parseJson(text) {
  const clean = text.replace(/```(?:json)?/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.search(/[[{]/);
    const end = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function listFrom(parsed, key) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed[key])) return parsed[key];
  return null;
}

const trimSlash = (u) => String(u || '').trim().replace(/\/+$/, '');
const hint = (key) => (key ? `••••${key.slice(-4)}` : null);

// Config from environment variables (used until something is saved in the UI).
export function configFromEnv() {
  const env = process.env;
  if (env.BRAIN_LLM_PROVIDER && PROVIDERS[env.BRAIN_LLM_PROVIDER]) {
    const p = env.BRAIN_LLM_PROVIDER;
    return { provider: p, baseUrl: env.BRAIN_LLM_BASE_URL || PROVIDERS[p].baseUrl, model: env.BRAIN_LLM_MODEL || env.BRAIN_MODEL || PROVIDERS[p].model, apiKey: env.BRAIN_LLM_API_KEY || '' };
  }
  if (env.BRAIN_LLM_BASE_URL) {
    // Legacy: an OpenAI-compatible endpoint (vLLM by default).
    return { provider: 'custom', baseUrl: env.BRAIN_LLM_BASE_URL, model: env.BRAIN_LLM_MODEL || 'qwen3-4b', apiKey: env.BRAIN_LLM_API_KEY || '' };
  }
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return { provider: 'anthropic', model: env.BRAIN_MODEL || PROVIDERS.anthropic.model };
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.keyEnv && id !== 'custom' && env[p.keyEnv]) return { provider: id, baseUrl: p.baseUrl, model: p.model };
  }
  return { provider: 'offline' };
}

export class LLM {
  /**
   * @param {object} opts
   * @param {boolean} [opts.offline]       force offline (tests)
   * @param {string}  [opts.settingsFile]  where UI-saved settings live
   * @param {object}  [opts.config]        explicit config (skips file/env)
   */
  constructor({ offline = false, settingsFile = null, config = null } = {}) {
    this.forcedOffline = offline || process.env.BRAIN_OFFLINE === '1';
    this.settingsFile = settingsFile;
    this.lastError = null;
    let cfg = config;
    this.source = config ? 'explicit' : 'env';
    if (!cfg && settingsFile && fs.existsSync(settingsFile)) {
      try {
        cfg = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).llm;
        if (cfg) this.source = 'settings';
      } catch (e) {
        console.warn('[llm] could not read settings:', e.message);
      }
    }
    this.configure(cfg || configFromEnv(), { persist: false });
  }

  // ---------------- configuration ----------------
  configure(input = {}, { persist = true } = {}) {
    const provider = PROVIDERS[input.provider] ? input.provider : 'offline';
    const p = PROVIDERS[provider];
    const prev = this.cfg || {};
    // An empty apiKey means "keep the saved one" when the provider is unchanged.
    const apiKey = input.apiKey === undefined || input.apiKey === '' ? (prev.provider === provider ? prev.apiKey || '' : '') : String(input.apiKey).trim();
    this.cfg = {
      provider,
      baseUrl: p.kind === 'openai-compat' ? trimSlash(input.baseUrl || p.baseUrl) : '',
      model: String(input.model || p.model || '').trim(),
      utilityModel: String(input.utilityModel || '').trim(),
      apiKey,
      temperature: input.temperature === undefined || input.temperature === '' || input.temperature === null ? 0.4 : Math.max(0, Math.min(2, Number(input.temperature))),
      maxTokens: Math.max(64, Math.min(32000, Number(input.maxTokens) || (p.local ? 700 : 2000))),
    };
    this.quirks = { maxTokensParam: 'max_tokens', temperature: true, jsonMode: true, extras: !p.quirks?.noExtras, ...(p.quirks || {}) };
    delete this.quirks.noExtras;
    this.lastError = null;
    this.client = null;
    if (!this.forcedOffline && p.kind === 'anthropic') {
      const key = this.cfg.apiKey || process.env.ANTHROPIC_API_KEY;
      if (key || process.env.ANTHROPIC_AUTH_TOKEN) this.client = new Anthropic({ apiKey: key || undefined, timeout: TIMEOUT_MS, maxRetries: 1 });
    } else if (!this.forcedOffline && p.kind === 'openai-compat' && this.cfg.baseUrl && this.cfg.model) {
      this.client = 'openai-compat';
    }
    if (persist) {
      this.source = 'settings';
      this.save();
    }
    return this.publicConfig();
  }

  save() {
    if (!this.settingsFile) return;
    let data = {};
    try {
      if (fs.existsSync(this.settingsFile)) data = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
    } catch {}
    data.llm = this.cfg;
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  // The key resolved for the current provider: UI-saved first, then env.
  get apiKey() {
    const p = PROVIDERS[this.cfg.provider];
    return this.cfg.apiKey || (p.keyEnv ? process.env[p.keyEnv] || '' : '') || '';
  }

  // Safe to send to the browser: never includes the key.
  publicConfig() {
    const p = PROVIDERS[this.cfg.provider];
    const envKey = p.keyEnv && process.env[p.keyEnv] ? p.keyEnv : null;
    return {
      provider: this.cfg.provider,
      baseUrl: this.cfg.baseUrl,
      model: this.cfg.model,
      utilityModel: this.cfg.utilityModel,
      temperature: this.cfg.temperature,
      maxTokens: this.cfg.maxTokens,
      hasKey: !!this.cfg.apiKey,
      keyHint: hint(this.cfg.apiKey),
      envKey,
      source: this.source,
      available: this.available,
      forcedOffline: this.forcedOffline,
      label: this.label,
      quirks: this.quirks,
    };
  }

  static catalog() {
    return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, vendor: p.vendor, kind: p.kind, baseUrl: p.baseUrl || '', model: p.model || '', utility: p.utility || '', needsKey: p.needsKey, local: !!p.local, keyEnv: p.keyEnv || null, envKeySet: !!(p.keyEnv && process.env[p.keyEnv]) }));
  }

  get provider() {
    return this.cfg.provider;
  }

  get model() {
    return this.cfg.model;
  }

  get available() {
    return !!this.client;
  }

  get label() {
    const p = PROVIDERS[this.cfg.provider];
    if (p.kind === 'offline') return 'Offline';
    return `${p.label} · ${this.cfg.model}`;
  }

  // ---------------- transport ----------------
  async _call(opts) {
    const p = PROVIDERS[this.cfg.provider];
    const model = opts.utility && this.cfg.utilityModel ? this.cfg.utilityModel : this.cfg.model;
    return p.kind === 'anthropic' ? this._callAnthropic({ ...opts, model }) : this._callOpenAI({ ...opts, model });
  }

  async _callAnthropic({ system, messages, effort = 'low', maxTokens, model }) {
    const res = await this.client.beta.messages.create({
      model,
      max_tokens: maxTokens || this.cfg.maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      system,
      messages,
    });
    if (res.stop_reason === 'refusal') throw new Error('model refused the request');
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return { text, usage: res.usage, model: res.model };
  }

  _headers() {
    const h = { 'content-type': 'application/json' };
    const key = this.apiKey;
    if (key) h.authorization = `Bearer ${key}`;
    if (this.cfg.provider === 'openrouter') {
      h['http-referer'] = 'https://github.com/agent-brain-hub';
      h['x-title'] = 'Agent Brain Hub';
    }
    return h;
  }

  _body({ system, messages, maxTokens, json, model, budget }) {
    const q = this.quirks;
    const body = { model, messages: [{ role: 'system', content: system }, ...messages] };
    body[q.maxTokensParam] = budget ?? Math.min(maxTokens || this.cfg.maxTokens, this.cfg.maxTokens);
    // Not 0 for JSON: vLLM 0.10.2 crashes when a greedy structured-output
    // request is batched with a sampled one.
    if (q.temperature) body.temperature = json ? 0.1 : this.cfg.temperature;
    if (json && q.jsonMode) body.response_format = { type: 'json_object' };
    // Qwen3 hybrid models on local servers: skip <think>.
    if (q.extras) body.chat_template_kwargs = { enable_thinking: false };
    return body;
  }

  // Learn from a 400: drop / rename the parameter the provider rejected.
  _adapt(status, message) {
    if (status !== 400 && status !== 422) return false;
    const m = message.toLowerCase();
    const q = this.quirks;
    if (q.maxTokensParam === 'max_tokens' && /max_tokens/.test(m) && /max_completion_tokens|not supported|unsupported/.test(m)) return (q.maxTokensParam = 'max_completion_tokens'), true;
    if (q.temperature && /temperature/.test(m)) return (q.temperature = false), true;
    if (q.jsonMode && /response_format|json_object|json mode/.test(m)) return (q.jsonMode = false), true;
    if (q.extras && /chat_template_kwargs|unrecognized|unknown (field|parameter|argument)|extra (fields|inputs)|additional properties/.test(m)) return (q.extras = false), true;
    return false;
  }

  async _callOpenAI(opts) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(this._body(opts)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const msg = (await res.text()).slice(0, 400);
        if (this._adapt(res.status, msg)) continue;
        throw new Error(`${res.status} ${msg}`);
      }
      const data = await res.json();
      const choice = data.choices?.[0]?.message || {};
      const content = Array.isArray(choice.content) ? choice.content.map((c) => c.text || '').join('') : choice.content || '';
      const text = String(content).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const usage = data.usage ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens } : null;
      // A reasoning model (e.g. Qwen3 thinking builds on Ollama, which ignore
      // every switch to turn thinking off) can spend the whole budget thinking
      // and answer "". Ask once more with room for the answer.
      const thoughtOut = !text && !opts.budget && (choice.reasoning || choice.reasoning_content || data.choices?.[0]?.finish_reason === 'length');
      if (thoughtOut) return this._callOpenAI({ ...opts, budget: Math.min(4096, Math.max(2048, 4 * this.cfg.maxTokens)) });
      return { text, usage, model: data.model || opts.model };
    }
    throw new Error('provider kept rejecting the request parameters');
  }

  // ---------------- admin helpers ----------------
  // A throwaway instance with an unsaved config (key falls back to the saved one).
  withConfig(input) {
    const same = !input.provider || input.provider === this.cfg.provider;
    const base = same ? this.cfg : {};
    const tmp = new LLM({ config: { ...base, ...input, apiKey: input.apiKey || (same ? this.cfg.apiKey : '') } });
    tmp.forcedOffline = false;
    tmp.configure(tmp.cfg, { persist: false });
    return tmp;
  }

  async test() {
    const t0 = Date.now();
    if (!this.client) return { ok: false, error: PROVIDERS[this.cfg.provider].kind === 'offline' ? 'offline' : 'missing configuration (base URL / model / API key)' };
    try {
      const r = await this._call({ system: 'You are a connectivity check. Reply with exactly: OK', messages: [{ role: 'user', content: 'ping' }], maxTokens: 64 });
      return { ok: true, ms: Date.now() - t0, model: r.model, reply: r.text.slice(0, 120), quirks: this.quirks };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: e.message.slice(0, 400) };
    }
  }

  async listModels() {
    const p = PROVIDERS[this.cfg.provider];
    if (p.kind === 'anthropic') {
      if (!this.client) throw new Error('missing API key');
      const out = [];
      for await (const m of this.client.models.list({ limit: 100 })) out.push(m.id);
      return out;
    }
    if (p.kind !== 'openai-compat' || !this.cfg.baseUrl) return [];
    const res = await fetch(`${this.cfg.baseUrl}/models`, { headers: this._headers(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const list = data.data || data.models || [];
    return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).map((id) => id.replace(/^models\//, '')).sort();
  }

  // ---------------- cognitive tasks ----------------
  async generate({ system, messages, effort }) {
    if (!this.client) return null;
    try {
      const r = await this._call({ system, messages, effort });
      this.lastError = null;
      return r.text ? r : null;
    } catch (e) {
      this.lastError = e.message;
      console.warn('[llm] generate failed, using fallback:', e.message);
      return null;
    }
  }

  // Returns [{relation, value, isUpdate}] or null on failure. relations: the
  // registry's relations to reuse ([{name, labelText}]); new names are allowed.
  async extractFacts(text, relations = null) {
    if (!this.client) return null;
    const list = relations || Object.entries(RELATIONS).filter(([, r]) => r.writer !== 'system').map(([name, r]) => ({ name, labelText: r.label.en }));
    const rels = list.map((r) => `- ${r.name} — ${r.labelText}`).join('\n');
    const system =
      'You extract durable facts about the customer from one chat message for a memory system. ' +
      'Prefer these relations:\n' + rels + '\n' +
      'If a durable fact fits none of them, use a new short snake_case relation name (e.g. "favourite_colour", "loyalty_tier"). ' +
      'Never extract passwords, PINs, one-time codes, card numbers or other secrets. ' +
      'Return ONLY a JSON object like {"facts":[{"relation":"lives_in","value":"Hà Nội","isUpdate":false}]}. ' +
      'Only include facts explicitly stated in the message; never infer preferences from complaints or problems. Keep values short, in the original language. ' +
      'isUpdate=true when the customer says a previous fact changed. Use "dislikes" for negated preferences. ' +
      'Return {"facts":[]} when there is nothing durable.';
    try {
      const { text: out } = await this._call({ system, messages: [{ role: 'user', content: text }], maxTokens: 1500, json: true, utility: true });
      const facts = listFrom(parseJson(out), 'facts');
      if (!facts) return null;
      return facts
        .filter((f) => f && typeof f.relation === 'string' && f.relation !== 'policy' && f.value)
        .map((f) => ({ relation: f.relation, value: String(f.value), isUpdate: !!f.isUpdate }));
    } catch (e) {
      this.lastError = e.message;
      return null;
    }
  }


  async summarize(transcript, lang = 'vi') {
    if (!this.client) return null;
    const system =
      `Summarize this customer-service session for long-term episodic memory in 1-2 sentences, in ${LANGUAGE_NAME[normLang(lang)]}. ` +
      'Write about the customer and what they need, not about the session itself; never write about "this session". ' +
      'Keep decisions, outcomes, emotions and facts that matter later. ' +
      'Copy identifiers exactly as written: order numbers, product and model names, amounts, dates and places. ' +
      'No PII (phone numbers, emails, card numbers).';
    try {
      const r = await this._call({ system, messages: [{ role: 'user', content: transcript }], utility: true });
      return r.text || null;
    } catch (e) {
      this.lastError = e.message;
      return null;
    }
  }

  async reflect(material, lang = 'vi') {
    if (!this.client) return null;
    const system =
      'You are the reflection engine (default mode network) of an agent memory system. From these episodes, ' +
      `write at most 3 short high-level insights in ${LANGUAGE_NAME[normLang(lang)]} about the customer that would help any agent serve them proactively. ` +
      'Ignore facts marked as conflicting or unconfirmed. All episodes are about ONE customer; a name in [brackets] is the agent who served them, not a customer. ' +
      'Return ONLY a JSON object like {"insights":["..."]}.';
    try {
      const { text } = await this._call({ system, messages: [{ role: 'user', content: material }], json: true, utility: true });
      const list = listFrom(parseJson(text), 'insights');
      return list ? list.filter((x) => typeof x === 'string' && x.trim()) : null;
    } catch (e) {
      this.lastError = e.message;
      return null;
    }
  }
}
