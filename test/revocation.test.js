// Authorization at retrieval time, for derived text too. A fact can stop being
// visible after it was stored (its relation narrowed to private, an agent's read
// permission revoked), but copies of its value live on in session summaries,
// conversation turns and handoffs. Found by a reader on daily.dev.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';

const makeBrain = () => new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const C = 'kh-r';
const sees = async (b, agentId, text, re) => {
  const r = await b.recall({ agentId, customerId: C, text, lang: 'en' });
  return r.memories.some((m) => re.test(m.text)) || re.test(r.promptBlock);
};

async function goldMember(b) {
  await b.remember({ agentId: 'kai', customerId: C, userText: 'I am a gold member of your loyalty programme', facts: [{ relation: 'loyalty_tier', value: 'gold' }], lang: 'en' });
  b.updateRelation('loyalty_tier', { action: 'promote', scope: 'shared', policy: 'trust' });
  b.advanceClock(0.1);
  await b.sleep({ customerId: C, lang: 'en' });
}

test('revocation: a relation narrowed to private is gone from summaries other domains read', async () => {
  const b = makeBrain();
  await goldMember(b);
  assert.ok(await sees(b, 'atlas', 'What loyalty tier is this customer?', /gold/i), 'shared: other domains see it (fact and summary)');
  b.updateRelation('loyalty_tier', { action: 'promote', scope: 'private' });
  assert.ok(!(await sees(b, 'atlas', 'What loyalty tier is this customer?', /gold/i)), 'private: neither the fact nor the old summary reaches another domain');
  assert.ok(await sees(b, 'kai', 'What loyalty tier is this customer?', /gold/i), 'the owner domain still sees everything');
  const r = await b.recall({ agentId: 'atlas', customerId: C, text: 'loyalty programme', lang: 'en' });
  assert.ok(r.memories.some((m) => m.kind === 'episodic' && /loyalty programme/.test(m.text)), 'the rest of the summary is still useful');
});

test('revocation: an agent whose shared read permission is revoked sees nothing shared, on the next call', async () => {
  const b = makeBrain();
  await goldMember(b);
  b.updateAgent('atlas', { permissions: { readShared: false } });
  assert.ok(!(await sees(b, 'atlas', 'What loyalty tier is this customer?', /gold/i)));
  b.updateAgent('atlas', { permissions: { readShared: true } });
  assert.ok(await sees(b, 'atlas', 'What loyalty tier is this customer?', /gold/i), 'granting it back works the same way');
});

test('revocation: turns and handoffs another agent reads do not carry a value it may not see', async () => {
  const b = makeBrain();
  // loyalty_tier is learned, so it starts private to the repair domain; the turn itself is in a shared session.
  await b.remember({ agentId: 'kai', customerId: C, userText: 'I am a gold member of your loyalty programme', facts: [{ relation: 'loyalty_tier', value: 'gold' }], lang: 'en' });
  await b.think({ agentId: 'atlas', customerId: C, text: 'Book me a flight to Da Nang', lang: 'en' });
  const r = await b.recall({ agentId: 'atlas', customerId: C, text: 'Which seat class should I pick for this customer?', lang: 'en' });
  assert.doesNotMatch(r.promptBlock, /gold/i, 'working memory and the handoff package are redacted for atlas');
  assert.match(r.promptBlock, /loyalty programme/, 'only the value is hidden, not the turn');
  const k = await b.recall({ agentId: 'kai', customerId: C, text: 'loyalty', lang: 'en' });
  assert.match(k.promptBlock, /gold/i, 'kai, in the owner domain, still sees it');
});

test('revocation: what an agent may see is never redacted', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', customerId: C, text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'sage', customerId: C, text: 'I am allergic to peanuts', lang: 'en' });
  b.advanceClock(0.1);
  await b.sleep({ customerId: C, lang: 'en' });
  const r = await b.recall({ agentId: 'atlas', customerId: C, text: 'Book a taxi from my home in Hanoi', lang: 'en' });
  assert.match(r.promptBlock, /Hanoi/, 'shared values are untouched');
  assert.doesNotMatch(r.promptBlock, /peanut/i);
});

test('revocation: an agent without shared-read permission does not see other agents\' turns at all', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', customerId: C, text: 'My daughter starts school next Monday', lang: 'en' });
  b.updateAgent('atlas', { permissions: { readShared: false } });
  const r = await b.recall({ agentId: 'atlas', customerId: C, text: 'Plan a weekend trip', lang: 'en' });
  assert.doesNotMatch(r.promptBlock, /daughter|school/i, 'working memory follows readShared like every other shared memory');
  b.updateAgent('atlas', { permissions: { readShared: true } });
  const r2 = await b.recall({ agentId: 'atlas', customerId: C, text: 'Plan a weekend trip', lang: 'en' });
  assert.match(r2.promptBlock, /daughter/i);
});
