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
import { stateAt } from '../server/brain/temporal.js';

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

const active = (b, re) => b.state.facts.filter((f) => re.test(f.value) && stateAt(f, b.clock.now()) === 'active');

test('writeFact: "latest" lets a newer value from another agent win, recorded and undoable', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'atlas', text: "I'm flying to Tokyo next week", lang: 'en' });
  b.advanceClock(1 / 24);
  const r = await b.think({ agentId: 'mia', text: "I'm travelling to Seoul next week", lang: 'en' });
  assert.ok(r.learned.some((l) => l.action === 'arbitrated'), JSON.stringify(r.learned));
  assert.equal(active(b, /Seoul/).length, 1);
  assert.equal(active(b, /Tokyo/).length, 0);
  const tokyo = b.state.facts.find((f) => /Tokyo/.test(f.value));
  assert.equal(tokyo.invalidReason, 'outvoted');
  const d = b.state.decisions.at(-1);
  assert.equal(d.policy, 'latest');
  const before = b.clock.now();
  b.advanceClock(1 / 24);
  b.undoDecision(d.id);
  assert.equal(active(b, /Tokyo/).length, 1, 'the loser is back');
  assert.equal(active(b, /Seoul/).length, 0);
  assert.ok(b.state.decisions.at(-1).undoneAt);
  assert.ok(trustOf(b, 'mia') < 0.5 && trustOf(b, 'atlas') > 0.5, 'an undo teaches trust');
  const past = await b.recall({ agentId: 'atlas', text: "Book my flight for next week's trip", lang: 'en', asOf: before });
  const nowR = await b.recall({ agentId: 'atlas', text: "Book my flight for next week's trip", lang: 'en' });
  assert.ok(nowR.memories.some((m) => /Tokyo/.test(m.text)) && !nowR.memories.some((m) => /Seoul/.test(m.text)), 'now: Tokyo is back');
  assert.ok(past.memories.some((m) => /Seoul/.test(m.text)) && !past.memories.some((m) => /Tokyo/.test(m.text)), 'history before the undo is unchanged');
});

test('writeFact: "owner" keeps the finance domain\'s income over another domain\'s', async () => {
  const b = makeBrain();
  // Values must differ clearly: close values ("3000 USD" vs "3500 USD") are treated as an update first.
  await b.think({ agentId: 'penny', text: 'My salary is 3000 USD a month', lang: 'en' });
  const r = await b.think({ agentId: 'mia', text: 'My income is 2000 dollars', lang: 'en' });
  assert.ok(r.learned.some((l) => l.action === 'outvoted'), JSON.stringify(r.learned));
  assert.equal(active(b, /3000 USD/).length, 1);
  assert.equal(active(b, /2000 dollars/).length, 0);
});

test('writeFact: a trust tie, or the same agent twice, is still a conflict; a customer update still wins', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  const tie = await b.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  assert.ok(tie.learned.some((l) => l.action === 'conflict'));
  const b2 = makeBrain();
  await b2.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  const upd = await b2.think({ agentId: 'atlas', text: 'I moved to Saigon last month', lang: 'en' });
  assert.ok(upd.learned.some((l) => l.action === 'superseded'));
});

test('trust: resolving a conflict and confirming a value move trust', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'atlas', text: 'I live in Da Nang', lang: 'en' });
  const hanoi = b.state.facts.find((f) => /Hanoi/.test(f.value));
  b.resolveConflict(hanoi.id);
  assert.ok(trustOf(b, 'mia') > 0.5 && trustOf(b, 'atlas') < 0.5);
  const b2 = makeBrain();
  await b2.think({ agentId: 'mia', text: 'I am vegetarian', lang: 'en' });
  await b2.think({ agentId: 'nova', text: 'I am vegetarian', lang: 'en' });
  await b2.think({ agentId: 'nova', text: 'I am vegetarian', lang: 'en' });
  assert.equal(b2.state.trust.mia.up, 1, 'confirmation counts once per agent');
});

// ---- Final review fixes (v0.7) ----

test('review fix: undo is refused once the winner has itself been replaced', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'atlas', text: "I'm flying to Tokyo next week", lang: 'en' });
  await b.think({ agentId: 'mia', text: "I'm travelling to Seoul next week", lang: 'en' });
  const d = b.state.decisions.at(-1);
  await b.think({ agentId: 'atlas', text: "Actually I'm going to Bangkok now", lang: 'en' });
  assert.throws(() => b.undoDecision(d.id), (e) => e.status === 409);
  assert.equal(active(b, /Tokyo/).length, 0, 'the old value does not come back next to the newer one');
  assert.equal(active(b, /Bangkok/).length, 1);
});

test('review fix: keeping one of 3+ clashing values settles all of them', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I live in Hue', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I live in Da Lat', lang: 'en' });
  const dalat = b.state.facts.find((f) => /Da Lat/.test(f.value));
  b.resolveConflict(dalat.id);
  const now = b.clock.now();
  const states = b.state.facts.filter((f) => f.relation === 'lives_in').map((f) => [f.value, stateAt(f, now)]);
  assert.deepEqual(states.filter(([, s]) => s === 'active' || s === 'conflicted'), [['Da Lat', 'active']], JSON.stringify(states));
  assert.equal(b.review('en').conflicts.length, 0);
});

test('minor fix: undo brings back every value a decision outvoted', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'I live in Hanoi', lang: 'en' });
  await b.think({ agentId: 'mia', text: 'I live in Hue', lang: 'en' }); // same agent: a conflict pair
  b.updateRelation('lives_in', { action: 'edit', policy: 'latest' });
  await b.think({ agentId: 'atlas', text: 'I live in Da Lat', lang: 'en' }); // outvotes both
  const d = b.state.decisions.at(-1);
  assert.equal(d.loserIds.length, 2);
  b.undoDecision(d.id);
  const live = b.state.facts.filter((f) => f.relation === 'lives_in' && ['active', 'conflicted'].includes(stateAt(f, b.clock.now()))).map((f) => f.value).sort();
  assert.deepEqual(live, ['Hanoi', 'Hue']);
  assert.equal(b.review('en').conflicts.length, 1, 'they come back as the conflict they were');
});

test('retrieval: a question about earnings reaches the income fact (vi / en / ja)', async () => {
  // Found by the LLM benchmark: "How much do I earn per month?" was a general
  // question, so the income fact stayed below the relevance threshold; the
  // offline run only passed because the extractive session summary repeated it.
  for (const [lang, say, ask, want] of [
    ['en', 'My salary is 3000 USD a month', 'How much do I earn per month?', /3000 USD/],
    ['vi', 'Lương tôi 30 triệu', 'Mỗi tháng tôi kiếm được bao nhiêu?', /30 triệu/],
    ['ja', '私の給料は30万円です', '毎月の収入はいくら？', /30万円/],
  ]) {
    const b = makeBrain();
    await b.think({ agentId: 'penny', text: say, lang });
    b.advanceClock(2 / 24);
    const r = await b.recall({ agentId: 'penny', text: ask, lang });
    assert.ok(r.memories.some((m) => m.kind === 'semantic' && want.test(m.text)), `${lang}: ${r.memories.map((m) => m.text).join(' | ')}`);
  }
});
