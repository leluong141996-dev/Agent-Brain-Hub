// v0.7: write arbitration between agents, and agent trust.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { trustOf, reward, penalize, trustView } from '../server/brain/trust.js';
import { arbitrate } from '../server/brain/arbitration.js';
import { relationOf } from '../server/brain/registry.js';

const makeBrain = () => new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const agent = (b, id) => b.getAgent(id);

test('trust: starts at 0.5 and moves with evidence', () => {
  const b = makeBrain();
  assert.equal(trustOf(b, 'mia'), 0.5);
  reward(b, 'mia');
  reward(b, 'mia');
  assert.ok(Math.abs(trustOf(b, 'mia') - 4 / 6) < 1e-9);
  penalize(b, 'kai');
  assert.ok(trustOf(b, 'kai') < 0.5);
  assert.deepEqual(trustView(b, 'mia'), { score: 0.67, up: 2, down: 0 });
});

test('arbitrate: latest, human, owner and trust', () => {
  const b = makeBrain();
  const old = (agentId) => ({ sourceAgentId: agentId });
  assert.equal(arbitrate(b, { rel: relationOf(b, 'budget'), agent: agent(b, 'nova'), old: old('penny') }).winner, 'new');
  assert.equal(arbitrate(b, { rel: { ...relationOf(b, 'budget'), policy: 'human' }, agent: agent(b, 'nova'), old: old('penny') }).winner, null);
  // owner: income belongs to finance (penny)
  assert.equal(arbitrate(b, { rel: relationOf(b, 'income'), agent: agent(b, 'mia'), old: old('penny') }).winner, 'old');
  assert.equal(arbitrate(b, { rel: relationOf(b, 'income'), agent: agent(b, 'penny'), old: old('mia') }).winner, 'new');
  assert.equal(arbitrate(b, { rel: relationOf(b, 'income'), agent: agent(b, 'mia'), old: old('kai') }).winner, null, 'no owner on either side');
  // trust: a tie goes to a human; a clear gap decides
  assert.equal(arbitrate(b, { rel: relationOf(b, 'lives_in'), agent: agent(b, 'atlas'), old: old('mia') }).winner, null);
  for (let i = 0; i < 3; i++) reward(b, 'mia');
  assert.equal(arbitrate(b, { rel: relationOf(b, 'lives_in'), agent: agent(b, 'atlas'), old: old('mia') }).winner, 'old');
});

test('arbitrate: the same agent on both sides is the customer contradicting themselves', () => {
  const b = makeBrain();
  for (let i = 0; i < 5; i++) reward(b, 'mia');
  const d = arbitrate(b, { rel: relationOf(b, 'lives_in'), agent: agent(b, 'mia'), old: { sourceAgentId: 'mia' } });
  assert.equal(d.winner, null);
  assert.equal(d.reason, 'same_agent');
  assert.equal(arbitrate(b, { rel: relationOf(b, 'budget'), agent: agent(b, 'mia'), old: { sourceAgentId: 'mia' } }).winner, 'new', 'latest still applies');
});
