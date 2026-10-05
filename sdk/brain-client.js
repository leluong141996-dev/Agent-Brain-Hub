// Agent Brain Hub — JavaScript client for connected (external) agents.
// Zero dependencies; works in Node ≥ 18, Deno, Bun and browsers.
//
//   import { BrainClient } from './sdk/brain-client.js';
//   const brain = new BrainClient({ url: 'http://localhost:4317', apiKey: process.env.BRAIN_API_KEY });
//   const ctx = await brain.recall({ customerId: 'kh-001', text: userMessage, lang: 'en' });
//   const reply = await myOwnLLM(ctx.promptBlock, userMessage);
//   await brain.remember({ traceId: ctx.traceId, reply });

export class BrainError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class BrainClient {
  constructor({ url = 'http://localhost:4317', apiKey, timeoutMs = 30000 } = {}) {
    if (!apiKey) throw new Error('BrainClient: apiKey is required (create a connected agent in the hub UI)');
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async #call(method, path, body) {
    const res = await fetch(this.url + path, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new BrainError(res.status, data.error || res.statusText);
    return data;
  }

  /** Who am I (agent id, domain, permissions). */
  me() {
    return this.#call('GET', '/v1/me');
  }

  /**
   * Retrieve the memory context for a user message.
   * Returns { traceId, intent, salience, handoff, playbook, memories[], suggestedActions[], promptBlock }.
   * Put `promptBlock` in your own system prompt.
   */
  recall({ customerId, text, lang = 'vi', includeSteps = false }) {
    return this.#call('POST', '/v1/recall', { customerId, text, lang, includeSteps });
  }

  /**
   * Hand the turn back so the brain can learn from it.
   * Pass the traceId from recall(), or userText if you skipped recall().
   * Optional: explicit facts [{relation, value}] and outcome {actionId, accepted}.
   */
  remember({ customerId, traceId, userText, reply, facts, outcome, lang = 'vi' }) {
    return this.#call('POST', '/v1/remember', { customerId, traceId, userText, reply, facts, outcome, lang });
  }

  /** Let the brain answer with its own LLM (native mode over the API). */
  chat({ customerId, text, lang = 'vi' }) {
    return this.#call('POST', '/v1/chat', { customerId, text, lang });
  }

  /** Report whether the customer accepted a suggested action. */
  feedback({ traceId, actionId, accepted, lang = 'vi' }) {
    return this.#call('POST', '/v1/feedback', { traceId, actionId, accepted, lang });
  }

  /** Facts about a customer that this agent is allowed to see. */
  profile({ customerId, lang = 'vi' }) {
    return this.#call('GET', `/v1/profile?customerId=${encodeURIComponent(customerId)}&lang=${lang}`);
  }
}
