// QA acceptance suite from the Vita Cognitive Memory Architecture doc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { addEpisode } from '../server/brain/neocortex.js';

function makeBrain() {
  return new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
}

test('Amnesia test — fact told to Auto is remembered by Travel without re-asking', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'kai', text: 'Xe của tôi là Toyota Vios, xe hỏng rồi phải sửa 3 ngày, bực quá!' });
  const r = await b.think({ agentId: 'atlas', text: 'Tôi cần đặt vé máy bay đi Đà Nẵng công tác' });
  assert.ok(r.handoff, 'corpus callosum produced a handoff package');
  const recalled = r.retrieval.selected.map((s) => s.text).join(' | ');
  assert.match(recalled, /không có xe 3 ngày/);
  assert.match(r.reply, /không có xe 3 ngày/);
  assert.equal(r.actions[0].id, 'rental_car_bundle', 'basal ganglia proposes a replacement vehicle');
});

test('Provenance — a reader sees who wrote a fact and how old it is (#11)', async () => {
  const DAY = 24 * 3600 * 1000;
  const b = makeBrain();
  await b.think({ agentId: 'kai', text: 'My car is a Honda Civic, it broke down and will be in the shop for 3 days', lang: 'en' });
  b.advanceClock(2);
  const ctx = await b.recall({ agentId: 'atlas', text: 'I need a flight to Da Nang next week', lang: 'en' });
  const line = ctx.promptBlock.split('\n').find((l) => /no car for 3 days/.test(l));
  assert.ok(line, 'the fact reaches the prompt');
  assert.match(line, /\(from Kai, 2 days ago, expires in 2 days\)/, 'source, age and expiry are in the prompt');
  const m = ctx.memories.find((x) => /no car for 3 days/.test(x.text));
  assert.equal(m.from, 'kai');
  assert.equal(Math.round((b.clock.now() - m.updatedAt) / DAY), 2, 'connected agents get the timestamp too');
  assert.ok(m.validUntil > b.clock.now());
});

test('Scoping — private health facts never reach other agents', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'sage', text: 'Tôi bị dị ứng hải sản' });
  const r = await b.think({ agentId: 'atlas', text: 'Đặt khách sạn có buffet hải sản giúp tôi' });
  assert.ok(!r.retrieval.selected.some((s) => /dị ứng/.test(s.text)));
  assert.ok(r.retrieval.excluded.some((s) => /dị ứng/.test(s.text) && /private/.test(s.reason)));
  const h = await b.think({ agentId: 'sage', text: 'Tôi muốn đặt lịch khám dị ứng' });
  assert.ok(h.retrieval.selected.some((s) => /dị ứng/.test(s.text)));
});

test('Contradiction test — conflicting facts are flagged, not silently resolved', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'Tôi sống ở Hà Nội' });
  const r = await b.think({ agentId: 'mia', text: 'Tôi sống ở Cần Thơ' });
  assert.ok(r.learned.some((l) => l.action === 'conflict'));
  const conflicted = b.state.facts.filter((f) => f.relation === 'lives_in' && f.status === 'conflicted');
  assert.equal(conflicted.length, 2);
  const again = await b.think({ agentId: 'mia', text: 'Bạn biết tôi sống ở đâu không?' });
  assert.match(again.reply, /chưa thống nhất/);
  // An explicit update supersedes instead of flagging.
  b.resolveConflict(conflicted[1].id);
  const u = await b.think({ agentId: 'mia', text: 'Mình mới chuyển đến Đà Nẵng' });
  assert.ok(u.learned.some((l) => l.action === 'superseded'));
});

test('Negation is a contradiction (thích X vs không thích X)', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'Tôi thích cà phê sữa đá' });
  const r = await b.think({ agentId: 'mia', text: 'Tôi không thích cà phê sữa đá' });
  assert.ok(r.learned.some((l) => l.action === 'conflict'));
});

test('Staleness test — expired facts stop being used and are forgotten', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'kai', text: 'Xe phải sửa 3 ngày' });
  b.advanceClock(5);
  const r = await b.think({ agentId: 'atlas', text: 'Đặt taxi ra sân bay giúp tôi' });
  assert.ok(!r.retrieval.selected.some((s) => s.relation === 'asset_unavailable'));
  assert.ok(r.retrieval.excluded.some((s) => /stale/.test(s.reason)));
  await b.sleep();
  assert.ok(!b.state.facts.some((f) => f.relation === 'asset_unavailable'), 'forgetting engine removed it for real');
});

test('Skill promotion test — 3 successes, 4th time uses the learned playbook', async () => {
  const b = makeBrain();
  for (let i = 0; i < 3; i++) {
    const r = await b.think({ agentId: 'kai', text: 'Tôi muốn đặt lịch bảo dưỡng xe' });
    assert.equal(r.mode, 'reasoning');
    b.feedback({ traceId: r.traceId, actionId: r.actions[0].id, accepted: true });
  }
  const r4 = await b.think({ agentId: 'kai', text: 'Đặt lịch bảo dưỡng giúp mình' });
  assert.equal(r4.mode, 'playbook');
  assert.ok(r4.skill && r4.skill.version === 1);
});

test('Sleep loop — consolidates sessions into episodes and reflects', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'kai', text: 'Xe tôi hỏng, gấp lắm!' });
  await b.think({ agentId: 'atlas', text: 'Đặt vé máy bay đi Hà Nội' });
  const s = await b.sleep();
  assert.equal(s.consolidated, 2);
  assert.ok(b.state.episodes.some((e) => e.kind === 'session'));
  assert.ok(s.insights.length >= 1);
  assert.ok(s.steps.some((st) => st.region === 'dmn'));
});

test('Brainstem — PII is redacted before memory', async () => {
  const b = makeBrain();
  const r = await b.think({ agentId: 'mia', text: 'Số tôi là 0912345678, email a.b@gmail.com' });
  assert.equal(r.redactions.length, 2);
  const wm = b.state.working['kh-001'];
  assert.ok(!JSON.stringify(wm).includes('0912345678'));
});

test('Load test — RAS stays fast with 20k episodes', async () => {
  const b = makeBrain();
  const agent = b.state.agents[0];
  for (let i = 0; i < 20000; i++) {
    addEpisode(b, { customerId: 'kh-001', agentId: agent.id, ownerDomain: 'auto', scope: 'shared', kind: 'session', text: `Phiên ${i}: khách hỏi về bảo dưỡng lần ${i % 50}, thay dầu, kiểm tra phanh` });
  }
  const r = await b.think({ agentId: 'kai', text: 'Lịch sử bảo dưỡng phanh của tôi' });
  assert.ok(r.retrieval.ms < 500, `retrieval took ${r.retrieval.ms}ms`);
});

test('LLM path — Claude reply, LLM-extracted facts and summaries are wired in', async () => {
  const calls = [];
  const llm = {
    available: true,
    model: 'stub',
    lastError: null,
    async generate({ system }) {
      calls.push(system);
      return { text: 'Dạ, mình đã nắm thông tin.', model: 'stub', usage: { input_tokens: 10, output_tokens: 5 } };
    },
    async extractFacts() {
      return [{ entity: 'customer', relation: 'occupation', value: 'kiến trúc sư' }];
    },
    async summarize() {
      return 'Khách hỏi về bảo dưỡng.';
    },
    async reflect() {
      return ['Khách quan tâm bảo dưỡng định kỳ.'];
    },
  };
  const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm, deterministic: true });
  const r = await b.think({ agentId: 'kai', text: 'Tôi thích xe Toyota, đặt lịch bảo dưỡng giúp tôi' });
  assert.equal(r.reply, 'Dạ, mình đã nắm thông tin.');
  assert.match(calls[0], /Next best action/);
  assert.ok(r.learned.some((l) => /kiến trúc sư/.test(l.text)), 'LLM facts merged with rule-based ones');
  await b.think({ agentId: 'atlas', text: 'Đặt vé máy bay đi Huế' }); // 2nd session → DMN has material
  const s = await b.sleep();
  assert.ok(b.state.episodes.some((e) => e.text.includes('Khách hỏi về bảo dưỡng.')));
  assert.deepEqual(s.insights, ['[Insight] Khách quan tâm bảo dưỡng định kỳ.']);
});

test('Scoping — private Health turns never reach another agent prompt, handoff or shared insights', async () => {
  const prompts = [];
  let reflectMaterial = '';
  const llm = {
    available: true,
    model: 'stub',
    label: 'stub',
    lastError: null,
    async generate({ system }) {
      prompts.push(system);
      return { text: 'ok', model: 'stub', usage: null };
    },
    async extractFacts() {
      return [];
    },
    async summarize(t) {
      return t.slice(0, 120);
    },
    async reflect(m) {
      reflectMaterial = m;
      return [];
    },
  };
  const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm, deterministic: true });
  await b.think({ agentId: 'kai', text: 'Xe tôi đang bảo dưỡng' });
  await b.think({ agentId: 'sage', text: 'Tôi bị dị ứng hải sản' });
  const r = await b.think({ agentId: 'atlas', text: 'Tìm khách sạn có buffet hải sản' });
  assert.ok(!/dị ứng/.test(prompts.at(-1)), 'travel prompt must not contain health turns');
  assert.ok(!JSON.stringify(r.handoff).includes('dị ứng'), 'handoff must not carry health turns');
  await b.think({ agentId: 'sage', text: 'Tôi muốn đặt lịch khám dị ứng' });
  assert.match(prompts.at(-1), /dị ứng/, 'health itself still sees its own turns');
  await b.sleep();
  assert.ok(reflectMaterial && !/dị ứng/.test(reflectMaterial), 'DMN (shared insights) must not reflect on private episodes');
});

test('English — amnesia across agents, English reply, labels and snapshot', async () => {
  const b = makeBrain();
  const r1 = await b.think({ agentId: 'kai', lang: 'en', text: 'My name is John Smith. My car is a Honda Civic, it broke down and will be in the shop for 3 days. So annoying!' });
  assert.ok(r1.learned.some((l) => l.text === 'availability: no car for 3 days'));
  assert.equal(r1.steps[0].label, 'Request received & routed');
  const r2 = await b.think({ agentId: 'atlas', lang: 'en', text: 'I need a flight to Da Nang next week, window seat please' });
  assert.match(r2.reply, /^Hi John,/);
  assert.match(r2.reply, /no car for 3 days/);
  assert.match(r2.reply, /flight to Da Nang/);
  assert.equal(r2.actions[0].id, 'rental_car_bundle');
  assert.equal(r2.actions[0].label, 'Self-drive rental at the destination (bundled)');
  const snap = b.snapshot('kh-001', 'en');
  assert.equal(snap.domains.travel.label, 'Travel & transport');
  assert.ok(snap.facts.some((f) => f.text === 'trip to: Da Nang'));
  const vi = b.snapshot('kh-001', 'vi');
  assert.ok(vi.facts.some((f) => f.text === 'chuyến đi tới: Da Nang'), 'same memory, Vietnamese labels');
});

test('English — contradiction asks to confirm; global policies are bilingual', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', lang: 'en', text: 'I live in London' });
  const r = await b.think({ agentId: 'mia', lang: 'en', text: 'I live in Paris' });
  assert.ok(r.learned.some((l) => l.action === 'conflict' && l.reason === 'two different values active at once'));
  const again = await b.think({ agentId: 'mia', lang: 'en', text: 'Where do I live?' });
  assert.match(again.reply, /conflicting information about "lives in"/);
  const snap = b.snapshot('kh-001', 'en');
  assert.ok(snap.facts.some((f) => f.scope === 'global' && /20% off/.test(f.text)));
});

test('General domains — finance is private, budget is shared with shopping', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'penny', text: 'Lương tôi 30 triệu, ngân sách mua sắm tháng này khoảng 5 triệu' });
  const r = await b.think({ agentId: 'nova', text: 'Tôi muốn mua giày chạy bộ, tôi mặc size 42' });
  const texts = r.retrieval.selected.map((s) => s.text).join(' | ');
  assert.match(texts, /ngân sách: 5 triệu/, 'shared budget reaches shopping');
  assert.ok(!/30 triệu/.test(texts), 'private income stays with finance');
  assert.equal(r.actions[0].id, 'product_shortlist');
  assert.match(r.reply, /5 triệu/);
});

test('General domains — a broken laptop does not trigger a car rental', async () => {
  const b = makeBrain();
  const r1 = await b.think({ agentId: 'kai', text: 'Laptop của tôi là MacBook Air, màn hình bị vỡ, phải bảo hành 5 ngày' });
  assert.ok(r1.learned.some((l) => /không có laptop 5 ngày/.test(l.text)));
  const r2 = await b.think({ agentId: 'atlas', text: 'Đặt vé máy bay đi Hà Nội giúp tôi' });
  assert.notEqual(r2.actions[0].id, 'rental_car_bundle');
});

test('Hippocampus — rule and LLM phrasings of one single-valued fact are not a self-contradiction', async () => {
  const llm = {
    available: true, model: 'stub', label: 'stub', lastError: null,
    async generate() { return { text: 'ok', model: 'stub', usage: null }; },
    async extractFacts() { return [{ entity: 'asset', relation: 'asset_unavailable', value: 'in the shop for 3 days' }]; },
    async summarize() { return null; },
    async reflect() { return null; },
  };
  const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm, deterministic: true });
  const r = await b.think({ agentId: 'kai', lang: 'en', text: 'My car broke down and will be in the shop for 3 days' });
  assert.ok(!r.learned.some((l) => l.action === 'conflict'), JSON.stringify(r.learned));
  assert.equal(b.state.facts.filter((f) => f.relation === 'asset_unavailable').length, 1);
});

test('Basal ganglia — exploration never lets a weakly relevant action beat a strongly relevant one', async () => {
  const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }) }); // random sampling
  await b.think({ agentId: 'kai', text: 'Xe tôi hỏng phải sửa 3 ngày' });
  for (let i = 0; i < 30; i++) {
    const r = await b.think({ agentId: 'atlas', text: 'Đặt vé máy bay đi Huế giúp tôi' });
    assert.ok(['rental_car_bundle', 'taxi_bundle'].includes(r.actions[0].id), r.actions[0].id);
  }
});

// ---------------- Hub: Japanese, connected agents, governance, value ----------------

test('Japanese — extraction, Japanese reply, labels and cross-agent memory', async () => {
  const b = makeBrain();
  const r1 = await b.think({ agentId: 'kai', lang: 'ja', text: '私の名前は田中です。私の車はトヨタのプリウスで、故障して修理に3日かかります。本当に困ります！' });
  assert.equal(r1.steps[0].label, 'リクエスト受信・ルーティング');
  assert.ok(['high', 'critical'].includes(r1.salience.priority));
  assert.ok(r1.learned.some((l) => l.text === '利用状況：車が3日間使えない'));
  const r2 = await b.think({ agentId: 'atlas', lang: 'ja', text: '来週ダナンへの出張の航空券を予約したいです。窓側の席がいいです' });
  assert.match(r2.reply, /^田中様、/);
  assert.match(r2.reply, /車が3日間使えない/);
  assert.match(r2.reply, /ダナン行き/);
  assert.equal(r2.actions[0].label, '現地レンタカーをセットで手配');
  const snap = b.snapshot('kh-001', 'ja');
  assert.equal(snap.domains.travel.label, '旅行・移動');
  assert.ok(snap.facts.some((f) => f.scope === 'global' && /20%割引/.test(f.text)));
});

test('Connected agent — recall returns shared memory, remember teaches the brain', async () => {
  const b = makeBrain();
  const events = [];
  b.bus.on('conversation', (e) => events.push(e));
  await b.think({ agentId: 'kai', text: 'Tên tôi là Lê Minh. Xe của tôi là Toyota Vios, xe hỏng phải sửa 3 ngày' });
  const { agent, apiKey } = b.createAgent({ name: 'Lumi', domain: 'travel', kind: 'external' });
  assert.match(apiKey, /^abk_/);
  assert.equal(b.agentByKey(apiKey).id, agent.id);
  assert.equal(b.agentByKey('abk_wrong'), null);

  const ctx = await b.recall({ agentId: agent.id, text: 'Tôi cần đặt vé máy bay đi Huế', lang: 'vi' });
  assert.ok(ctx.memories.some((m) => /không có xe 3 ngày/.test(m.text) && m.from === 'kai'));
  assert.match(ctx.promptBlock, /## Semantic memory/);
  assert.equal(ctx.suggestedActions[0].id, 'rental_car_bundle');
  assert.ok(ctx.steps.some((s) => s.region === 'output'));

  const r = await b.remember({ agentId: agent.id, traceId: ctx.traceId, reply: 'Mình sẽ tìm vé đi Huế cho anh.', facts: [{ relation: 'prefers_seat', value: 'lối đi' }], outcome: { actionId: 'rental_car_bundle', accepted: true } });
  assert.ok(r.learned.some((l) => /chuyến đi tới: Huế/.test(l.text)), 'facts extracted from the recalled user text');
  assert.ok(r.learned.some((l) => /ghế ưa thích: lối đi/.test(l.text)), 'explicit facts stored');
  assert.equal(r.feedback.bandit.alpha, 2, 'outcome trains the basal ganglia');
  assert.equal(events.length, 1);
  assert.equal(events[0].reply, 'Mình sẽ tìm vé đi Huế cho anh.');
  await assert.rejects(() => b.recall({ agentId: agent.id, text: '' }), /text is required/);
  await assert.rejects(b.remember({ agentId: 'kai', traceId: ctx.traceId, reply: 'x' }), /another agent/);
});

test('Governance — readShared=false and write=false are enforced and audited', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'mia', text: 'Tên tôi là Lê Minh, tôi sống ở Hà Nội' });
  const { agent } = b.createAgent({ name: 'Partner Bot', domain: 'shopping', kind: 'external', permissions: { readShared: false, write: false } });
  const ctx = await b.recall({ agentId: agent.id, text: 'Tôi muốn mua giày' });
  assert.ok(!ctx.memories.some((m) => /Lê Minh|Hà Nội/.test(m.text)), 'shared memory hidden');
  const r = await b.remember({ agentId: agent.id, traceId: ctx.traceId, reply: 'ok', facts: [{ relation: 'clothing_size', value: '42' }] });
  assert.equal(r.learned.length, 0, 'read-only agent writes nothing');
  assert.ok(!b.state.facts.some((f) => f.relation === 'clothing_size'));
  const blocked = b.state.audit.filter((e) => e.op === 'blocked' && e.agentId === agent.id);
  assert.ok(blocked.length >= 2, 'blocked reads are audited');
  b.updateAgent(agent.id, { permissions: { readShared: true } });
  const ctx2 = await b.recall({ agentId: agent.id, text: 'Tôi muốn mua giày' });
  assert.ok(ctx2.memories.some((m) => /Lê Minh/.test(m.text)), 'permission change takes effect');
});

test('Keys — rotation invalidates the old key; built-in agents cannot be deleted', () => {
  const b = makeBrain();
  const { agent, apiKey } = b.createAgent({ name: 'Bot', domain: 'personal' });
  const { apiKey: k2 } = b.rotateKey(agent.id);
  assert.equal(b.agentByKey(apiKey), null);
  assert.equal(b.agentByKey(k2).id, agent.id);
  assert.ok(!('keyHash' in b.snapshot().agents.find((a) => a.id === agent.id)), 'hash never exposed');
  assert.throws(() => b.deleteAgent('kai'), /cannot be deleted/);
});

test('Value report — cross-agent reuse, knowledge flow matrix, leaks blocked', async () => {
  const b = makeBrain();
  await b.think({ agentId: 'kai', text: 'Tên tôi là Lê Minh. Xe phải sửa 3 ngày' });
  await b.think({ agentId: 'sage', text: 'Tôi bị dị ứng hải sản' });
  const r = await b.think({ agentId: 'atlas', text: 'Đặt vé máy bay đi Huế' });
  b.feedback({ traceId: r.traceId, actionId: r.actions[0].id, accepted: true });
  const v = b.valueReport('en');
  assert.ok(v.kpis.crossAgentReuse >= 2);
  assert.ok(v.kpis.questionsSaved >= 2);
  assert.ok(v.kpis.leaksBlocked >= 1, 'allergy blocked from atlas');
  assert.equal(v.kpis.acceptanceRate, 1);
  assert.equal(v.kpis.handoffs, 2);
  const iK = v.flow.agents.findIndex((a) => a.id === 'kai');
  const iA = v.flow.agents.findIndex((a) => a.id === 'atlas');
  assert.ok(v.flow.matrix[iK][iA] >= 2, 'kai → atlas knowledge flow');
  assert.equal(v.perAgent.find((a) => a.id === 'kai').reusedByOthers >= 2, true);
  assert.equal(v.daily.length, 7);
  assert.ok(v.daily.at(-1).turns >= 3, 'today is the last bucket');
});
