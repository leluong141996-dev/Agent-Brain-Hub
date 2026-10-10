// LLM provider layer: configuration, key handling, and automatic adaptation
// to provider quirks — tested against a strict OpenAI-like mock server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LLM, PROVIDERS } from '../server/llm.js';

// Mimics OpenAI's strictness for reasoning models.
function strictServer() {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Bearer sk-test') return send(401, { error: { message: 'Incorrect API key provided' } });
    if (req.url === '/v1/models') return send(200, { object: 'list', data: [{ id: 'gpt-x' }, { id: 'gpt-x-mini' }] });
    const body = JSON.parse(raw);
    seen.push(Object.keys(body).sort().join(','));
    if ('chat_template_kwargs' in body) return send(400, { error: { message: 'Unrecognized request argument supplied: chat_template_kwargs' } });
    if ('max_tokens' in body) return send(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } });
    if ('temperature' in body) return send(400, { error: { message: "Unsupported value: 'temperature' does not support 0.4 with this model." } });
    const isJson = body.response_format?.type === 'json_object';
    return send(200, { model: body.model, choices: [{ message: { content: isJson ? '{"facts":[{"relation":"lives_in","value":"Huế"}]}' : 'OK' } }], usage: { prompt_tokens: 10, completion_tokens: 1 } });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, seen, url: `http://localhost:${server.address().port}/v1` })));
}

test('provider catalog covers the major vendors', () => {
  for (const id of ['anthropic', 'openai', 'gemini', 'deepseek', 'mistral', 'groq', 'xai', 'openrouter', 'ollama', 'vllm', 'custom', 'offline']) assert.ok(PROVIDERS[id], id);
  assert.match(PROVIDERS.gemini.baseUrl, /generativelanguage\.googleapis\.com/);
  assert.match(PROVIDERS.deepseek.baseUrl, /api\.deepseek\.com/);
});

test('adapts to a strict provider: drops unknown params, renames max_tokens, drops temperature', async () => {
  const { server, seen, url } = await strictServer();
  try {
    const llm = new LLM({ config: { provider: 'custom', baseUrl: url, model: 'gpt-x', apiKey: 'sk-test' } });
    llm.forcedOffline = false;
    llm.configure(llm.cfg, { persist: false });
    const r = await llm.generate({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.text, 'OK');
    assert.equal(llm.quirks.extras, false);
    assert.equal(llm.quirks.maxTokensParam, 'max_completion_tokens');
    assert.equal(llm.quirks.temperature, false);
    const before = seen.length;
    await llm.generate({ system: 'sys', messages: [{ role: 'user', content: 'again' }] });
    assert.equal(seen.length, before + 1, 'quirks are remembered: no more retries');
    const facts = await llm.extractFacts('Tôi sống ở Huế');
    assert.deepEqual(facts.map((f) => [f.relation, f.value]), [['lives_in', 'Huế']]);
    assert.deepEqual(await llm.listModels(), ['gpt-x', 'gpt-x-mini']);
  } finally {
    server.close();
  }
});

test('test() reports success and auth errors clearly', async () => {
  const { server, url } = await strictServer();
  try {
    const good = new LLM({ config: { provider: 'custom', baseUrl: url, model: 'gpt-x', apiKey: 'sk-test' } }).withConfig({});
    const ok = await good.test();
    assert.equal(ok.ok, true);
    assert.equal(ok.reply, 'OK');
    const bad = good.withConfig({ apiKey: 'sk-wrong' });
    const ko = await bad.test();
    assert.equal(ko.ok, false);
    assert.match(ko.error, /401/);
  } finally {
    server.close();
  }
});

test('settings persist to disk, the key is masked and kept when left blank', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-')), 'settings.json');
  const llm = new LLM({ settingsFile: file });
  const pub = llm.configure({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-deepseek-1234' });
  assert.equal(pub.keyHint, '••••1234');
  assert.ok(!JSON.stringify(pub).includes('sk-deepseek'), 'public config never contains the key');
  assert.equal(pub.baseUrl, PROVIDERS.deepseek.baseUrl);
  llm.configure({ provider: 'deepseek', model: 'deepseek-reasoner', apiKey: '' });
  assert.equal(llm.apiKey, 'sk-deepseek-1234', 'blank key keeps the saved one');
  const reloaded = new LLM({ settingsFile: file });
  assert.equal(reloaded.cfg.model, 'deepseek-reasoner');
  assert.equal(reloaded.source, 'settings');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600', 'settings file is private');
  reloaded.configure({ provider: 'gemini', model: 'gemini-2.5-flash' });
  assert.equal(reloaded.cfg.apiKey, '', 'switching provider never reuses another vendor key');
});

test('offline provider and forced offline never call out', async () => {
  const llm = new LLM({ offline: true, config: { provider: 'openai', model: 'gpt-5-mini', apiKey: 'sk' } });
  assert.equal(llm.available, false);
  assert.equal(await llm.generate({ system: 's', messages: [] }), null);
  const off = new LLM({ config: { provider: 'offline' } });
  assert.equal(off.label, 'Offline');
  assert.equal((await off.test()).ok, false);
});

test('a reasoning model that runs out of tokens while thinking is asked again with more room', async () => {
  // Qwen3 "thinking" builds on Ollama always think, and ignore every switch to
  // turn it off; with the local 700-token cap they used to answer "".
  const budgets = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    const budget = body.max_tokens ?? body.max_completion_tokens;
    budgets.push(budget);
    res.writeHead(200, { 'content-type': 'application/json' });
    const enough = budget > 700;
    res.end(JSON.stringify({
      model: body.model,
      choices: [{ finish_reason: enough ? 'stop' : 'length', message: { content: enough ? '{"facts":[{"relation":"loyalty_tier","value":"gold"}]}' : '', reasoning: 'Okay, the user says they are a gold member…' } }],
      usage: { prompt_tokens: 10, completion_tokens: enough ? 900 : budget },
    }));
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const llm = new LLM({ config: { provider: 'ollama', baseUrl: `http://localhost:${server.address().port}/v1`, model: 'qwen3:4b' } });
    llm.forcedOffline = false;
    llm.configure(llm.cfg, { persist: false });
    const facts = await llm.extractFacts("I'm a gold member of your loyalty programme");
    assert.deepEqual(facts, [{ relation: 'loyalty_tier', value: 'gold', isUpdate: false }]);
    assert.equal(budgets.length, 2);
    assert.ok(budgets[1] >= 4 * budgets[0], `retried with more room: ${budgets}`);
  } finally {
    server.close();
  }
});
