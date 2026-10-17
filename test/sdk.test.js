// The JS and Python clients speak to a running hub: the same calls, the same
// errors. Python (standard library only) is skipped when python3 is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BrainClient } from '../sdk/brain-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0;

async function withHub(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-sdk-'));
  const port = 5100 + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT: String(port), BRAIN_DB: path.join(dir, 'brain.db'), BRAIN_SETTINGS: path.join(dir, 'settings.json'), BRAIN_OFFLINE: '1', BRAIN_ADMIN_TOKEN: 't' };
  const hub = spawn(process.execPath, [path.join(here, '..', 'server', 'index.js')], { env, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) {
      if (await fetch(`${url}/healthz`).then((r) => r.ok).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const made = await fetch(`${url}/api/agents`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 't' }, body: JSON.stringify({ name: 'SDK helper', domain: 'personal', kind: 'external' }) }).then((r) => r.json());
    return await fn({ url, apiKey: made.apiKey });
  } finally {
    hub.kill();
  }
}

test('js sdk: recall can look back in time (asOf)', async () => {
  await withHub(async ({ url, apiKey }) => {
    const brain = new BrainClient({ url, apiKey });
    await brain.remember({ customerId: 'c1', facts: [{ relation: 'lives_in', value: 'Hanoi' }], lang: 'en' });
    const before = Date.now() + 60_000; // the hub's clock is real time unless advanced
    const past = await brain.recall({ customerId: 'c1', text: 'Where do I live?', lang: 'en', asOf: 1 });
    assert.ok(!/Hanoi/.test(past.promptBlock), 'before it was known');
    const now = await brain.recall({ customerId: 'c1', text: 'Where do I live?', lang: 'en', asOf: before });
    assert.ok(/Hanoi/.test(now.promptBlock));
  });
});

test('python sdk: the same flow as the JS client, with the same errors', { skip: !hasPython && 'python3 not installed' }, async () => {
  await withHub(async ({ url, apiKey }) => {
    const code = `
import json, sys
sys.path.insert(0, sys.argv[1])
from brain_client import BrainClient, BrainError
brain = BrainClient(url=sys.argv[2], api_key=sys.argv[3])
out = {}
out['me'] = brain.me()['domain']
r = brain.remember(customer_id='c1', facts=[{'relation': 'lives_in', 'value': 'Hanoi'}], lang='en')
out['learned'] = [x['text'] for x in r['learned']]
out['recall'] = 'Hanoi' in brain.recall(customer_id='c1', text='Where do I live?', lang='en')['promptBlock']
out['past'] = 'Hanoi' in brain.recall(customer_id='c1', text='Where do I live?', lang='en', as_of=1)['promptBlock']
out['profile'] = [f['text'] for f in brain.profile(customer_id='c1', lang='en')['facts']]
out['correct'] = brain.correct(customer_id='c1', relation='lives_in', value='Saigon', reason='wrong city', lang='en')['fact']
out['forget'] = brain.forget(customer_id='c1', relation='lives_in')['removedFacts']
try:
    brain.correct(customer_id='c1', relation='lives_in', value='Hue')
except BrainError as e:
    out['error'] = e.status
try:
    BrainClient(url=sys.argv[2], api_key='abk_wrong').me()
except BrainError as e:
    out['auth'] = e.status
try:
    BrainClient(url=sys.argv[2])
except ValueError:
    out['needs_key'] = True
print(json.dumps(out))
`;
    const r = spawnSync('python3', ['-B', '-c', code, path.join(here, '..', 'sdk'), url, apiKey], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.me, 'personal');
    assert.ok(out.learned.some((t) => /Hanoi/.test(t)));
    assert.equal(out.recall, true);
    assert.equal(out.past, false);
    assert.ok(out.profile.some((t) => /Hanoi/.test(t)));
    assert.match(out.correct, /Saigon/);
    assert.equal(out.forget, 2);
    assert.equal(out.error, 404);
    assert.equal(out.auth, 401);
    assert.equal(out.needs_key, true);
  });
});
