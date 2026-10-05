// End-to-end test against a RUNNING Agent Brain server (offline, Claude or vLLM).
// Walks one customer through every brain region and grades each step.
//   npm start                      (in another terminal)
//   npm run e2e                    Vietnamese scenario
//   npm run e2e -- --lang en       English scenario
//   npm run e2e -- --lang ja       Japanese scenario
//   node scripts/e2e.mjs --url http://localhost:4317 --lang en
// Uses a fresh customer id, so existing memories are not touched.
// Note: step 7 advances the brain's simulated clock by 7 days (global).

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg('url', process.env.BRAIN_URL || 'http://localhost:4317');
const LANG = ['vi', 'en', 'ja'].includes(arg('lang', process.env.BRAIN_LANG || 'vi')) ? arg('lang', process.env.BRAIN_LANG || 'vi') : 'vi';
const CUSTOMER = `e2e-${LANG}-${Date.now().toString(36)}`;

// Scenario text and the facts we expect the brain to extract, per language.
const S = {
  vi: {
    breakdown: 'Tên tôi là Lê Minh. Xe của tôi là Toyota Vios, xe hỏng nặng phải sửa 3 ngày, bực quá!',
    name: /Lê Minh/,
    noCar: /không có xe 3 ngày/,
    flight: 'Tôi cần đặt vé máy bay đi Đà Nẵng công tác tuần sau',
    allergy: 'Tôi bị dị ứng hải sản',
    allergyRe: /dị ứng/i,
    hotel: 'Tìm giúp tôi khách sạn có buffet hải sản ở Đà Nẵng',
    finance: 'Lương tôi 30 triệu, ngân sách mua sắm tháng này khoảng 5 triệu',
    budgetRe: /5 triệu/,
    incomeRe: /30 triệu/,
    shop: 'Tôi muốn mua giày chạy bộ, tôi mặc size 42',
    home1: 'Tôi sống ở Hà Nội',
    home2: 'Tôi sống ở Cần Thơ',
    pii: 'Số của tôi là 0912 345 678, email minh@gmail.com',
    maint: 'Tôi muốn đặt lịch bảo dưỡng xe',
    maint4: 'Đặt lịch bảo dưỡng giúp mình',
    taxi: 'Đặt taxi ra sân bay giúp tôi',
    warranty: 'Tôi muốn gia hạn bảo hành và cần biết tình trạng xe',
  },
  en: {
    breakdown: 'My name is John Smith. My car is a Honda Civic, it broke down and will be in the shop for 3 days. So annoying!',
    name: /John Smith/,
    noCar: /no car for 3 days/,
    flight: 'I need a flight to Da Nang for a business trip next week',
    allergy: 'I am allergic to peanuts',
    allergyRe: /allerg|peanut/i,
    hotel: 'Find me a hotel in Da Nang with a good breakfast buffet',
    finance: 'My salary is 3000 usd a month and my shopping budget this month is about 400 usd',
    budgetRe: /400 usd/,
    incomeRe: /3000 usd/,
    shop: 'I want to buy running shoes, I wear size 42',
    home1: 'I live in London',
    home2: 'I live in Paris',
    pii: 'My number is 0912 345 678, email john@gmail.com',
    maint: 'I want to book a maintenance appointment for my car',
    maint4: 'Please book maintenance for me',
    taxi: 'Book me an airport taxi',
    warranty: 'I want to extend my warranty and check on my car',
  },
  ja: {
    breakdown: '私の名前は田中です。私の車はトヨタのプリウスで、故障して修理に3日かかります。本当に困ります！',
    name: /田中/,
    noCar: /車が3日間使えない/,
    flight: '来週ダナンへの出張の航空券を予約したいです',
    allergy: '私は卵アレルギーです',
    allergyRe: /アレルギー|卵/,
    hotel: 'ダナンで朝食ビュッフェのあるホテルを探しています',
    finance: '給料は30万円です。今月の買い物の予算は5万円くらいです',
    budgetRe: /5万円/,
    incomeRe: /30万円/,
    shop: 'ランニングシューズを買いたいです。靴のサイズは27cmです',
    home1: '東京に住んでいます',
    home2: '大阪に住んでいます',
    pii: '電話番号は090-1234-5678、メールはtanaka@gmail.comです',
    maint: '車のメンテナンスを予約したいです',
    maint4: 'メンテナンスの予約をお願いします',
    taxi: '空港までのタクシーを手配してください',
    warranty: 'ノートパソコンの保証を延長したいです',
  },
}[LANG];

const results = [];
async function call(path, body) {
  const res = await fetch(BASE + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
}
const chat = (agentId, text) => call('/api/chat', { agentId, customerId: CUSTOMER, text, lang: LANG });
const snapshot = () => call(`/api/state?customerId=${CUSTOMER}&lang=${LANG}`);

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const checks = await fn();
    const failed = checks.filter(([, ok]) => !ok);
    results.push({ name, ok: !failed.length, ms: Date.now() - t0 });
    console.log(`\n${failed.length ? '❌' : '✅'} ${name}  (${Date.now() - t0}ms)`);
    for (const [label, ok, info] of checks) console.log(`   ${ok ? '✓' : '✗'} ${label}${info ? `  → ${info}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0 });
    console.log(`\n❌ ${name}\n   ✗ ${e.message}`);
  }
}

const has = (arr, re) => arr.some((x) => re.test(typeof x === 'string' ? x : JSON.stringify(x)));
const regions = (r) => [...new Set(r.steps.map((s) => s.region))];
const say = (r) => console.log(`   💬 ${r.reply.replace(/\s+/g, ' ').slice(0, 170)}`);

const state = await snapshot();
console.log(`Agent Brain E2E · ${BASE} · lang=${LANG} · customer ${CUSTOMER}\nLLM: ${state.llm.available ? state.llm.label : 'offline (template)'}`);

await step('1. Thalamus · Amygdala · Hippocampus — breakdown reported to Kai (repair)', async () => {
  const r = await chat('kai', S.breakdown);
  say(r);
  return [
    ['Amygdala tags priority high/critical', ['high', 'critical'].includes(r.salience.priority), r.salience.priority],
    ['Hippocampus stores the name', has(r.learned, S.name)],
    ['Hippocampus stores the car unavailability', has(r.learned, S.noCar)],
    ['Full awake loop (thalamus→…→hippocampus)', ['thalamus', 'brainstem', 'amygdala', 'prefrontal', 'cerebellum', 'ras', 'basal_ganglia', 'output', 'hippocampus'].every((x) => regions(r).includes(x))],
  ];
});

await step('2. Corpus callosum · RAS — Atlas (travel) knows without being told (Amnesia test)', async () => {
  const r = await chat('atlas', S.flight);
  say(r);
  const sel = r.retrieval.selected.find((s) => S.noCar.test(s.text));
  return [
    ['Handoff package Kai → Atlas', r.handoff?.from === 'Kai'],
    ['RAS retrieves the unavailability fact', !!sel, sel && `semantic · ${sel.tier} · scope ${sel.scope} · owner ${sel.owner} · score ${sel.score}`],
    ['Basal ganglia proposes alternative transport', ['rental_car_bundle', 'taxi_bundle'].includes(r.actions[0]?.id), r.actions[0]?.label],
  ];
});

await step('3. Partitioning — Sage (health) stores an allergy, Atlas must not see it', async () => {
  await chat('sage', S.allergy);
  const r = await chat('atlas', S.hotel);
  say(r);
  const ex = r.retrieval.excluded.find((s) => S.allergyRe.test(s.text));
  return [
    ['RAS excludes the allergy fact', !!ex, ex?.reason],
    ['No allergy memory in the context', !has(r.retrieval.selected.map((s) => s.text), S.allergyRe)],
    ['Reply does not mention the allergy', !S.allergyRe.test(r.reply)],
    ['Handoff does not carry what was said to Sage', !S.allergyRe.test(JSON.stringify(r.handoff || {}))],
  ];
});

await step('4. Partitioning — Penny (finance): budget is shared with Nova, income stays private', async () => {
  await chat('penny', S.finance);
  const r = await chat('nova', S.shop);
  say(r);
  const texts = r.retrieval.selected.map((s) => s.text);
  return [
    ['Nova sees the shared budget', has(texts, S.budgetRe)],
    ['Nova does not see the private income', !has(texts, S.incomeRe)],
    ['Basal ganglia proposes a budget shortlist', r.actions[0]?.id === 'product_shortlist', r.actions[0]?.label],
  ];
});

await step('5. Contradiction test — two different homes must be flagged (Mia)', async () => {
  await chat('mia', S.home1);
  const r = await chat('mia', S.home2);
  const s = await snapshot();
  const conflicted = s.facts.filter((f) => f.relation === 'lives_in' && f.status === 'conflicted');
  return [
    ['Neocortex returns a "conflict" write', has(r.learned, /"action":"conflict"/)],
    ['Both lives_in facts are conflicted', conflicted.length === 2, conflicted.map((f) => f.displayValue).join(' / ')],
  ];
});

await step('6. Brainstem — PII is redacted before memory', async () => {
  const r = await chat('mia', S.pii);
  const s = await snapshot();
  return [
    ['2 PII redacted (PHONE, EMAIL)', r.redactions.length === 2, r.redactions.map((x) => x.type).join(', ')],
    ['Working memory holds no real number', !JSON.stringify(s.working).includes('0912 345 678')],
  ];
});

await step('7. Basal ganglia · Cerebellum — 3 × 👍 then the 4th run uses a playbook (Skill promotion)', async () => {
  let promoted = null;
  const modes = [];
  for (let i = 0; i < 3; i++) {
    const r = await chat('kai', S.maint);
    modes.push(r.mode);
    const f = await call('/api/feedback', { traceId: r.traceId, actionId: r.actions[0].id, accepted: true, lang: LANG });
    promoted ||= f.promoted;
  }
  const r4 = await chat('kai', S.maint4);
  modes.push(r4.mode);
  say(r4);
  const preExisting = modes[0] === 'playbook';
  return [
    ['Skill promoted (or already learned in an earlier run)', !!promoted || preExisting, promoted ? `${promoted.name} v${promoted.version}` : preExisting ? 'skill already existed' : ''],
    ['4th run uses the playbook', r4.mode === 'playbook', modes.join(' → ')],
    ['Cerebellum reports a procedural HIT', r4.steps.some((s) => s.region === 'cerebellum' && s.status === 'hit')],
  ];
});

await step('8. Staleness test — after +7 days the unavailability fact has expired', async () => {
  await call('/api/clock', { days: 7 });
  const r = await chat('atlas', S.taxi);
  const ex = r.retrieval.excluded.find((s) => S.noCar.test(s.text));
  return [
    ['RAS no longer uses the expired fact', !has(r.retrieval.selected.map((s) => s.text), S.noCar)],
    ['Exclusion reason: stale', /stale/.test(ex?.reason || ''), ex?.reason],
  ];
});

await step('9. Sleep loop — consolidate, forget, reflect', async () => {
  const r = await call('/api/sleep', { customerId: CUSTOMER, lang: LANG });
  const s = await snapshot();
  for (const i of r.insights) console.log(`   💡 ${i.slice(0, 160)}`);
  return [
    ['Sessions consolidated into episodes', r.consolidated >= 3, `${r.consolidated} episodes`],
    ['Forgetting really deletes the expired fact', !s.facts.some((f) => S.noCar.test(f.value)), r.forgotten.expiredFacts.join('; ')],
    ['hippocampus → forgetting → dmn → cerebellum all ran', ['hippocampus', 'forgetting', 'dmn', 'cerebellum'].every((x) => r.steps.some((st) => st.region === x))],
    ['Shared insights hold no health data', !has(r.insights, S.allergyRe)],
    ['Shared insights hold no private income', !has(r.insights, S.incomeRe)],
  ];
});

await step('10. Connected agent (REST + SDK) — recall shared memory, remember teaches everyone', async () => {
  const { BrainClient } = await import('../sdk/brain-client.js');
  const created = await call('/api/agents', { name: `E2E Partner ${LANG}`, domain: 'repair', kind: 'external' });
  const client = new BrainClient({ url: BASE, apiKey: created.apiKey });
  const me = await client.me();
  const ctx = await client.recall({ customerId: CUSTOMER, text: S.warranty, lang: LANG });
  const rem = await client.remember({ traceId: ctx.traceId, reply: 'OK', facts: [{ relation: 'payment_method', value: 'paypal' }], lang: LANG });
  const prof = await client.profile({ customerId: CUSTOMER, lang: LANG });
  let unauthorized = false;
  try {
    await new BrainClient({ url: BASE, apiKey: 'abk_invalid' }).me();
  } catch (e) {
    unauthorized = e.status === 401;
  }
  return [
    ['API key authenticates the agent', me.kind === 'external', me.id],
    ['recall returns memories written by native agents', ctx.memories.some((m) => m.from === 'kai' || m.from === 'mia'), `${ctx.memories.length} memories`],
    ['recall returns a ready-to-use promptBlock', /## Semantic memory|## Current intent/.test(ctx.promptBlock)],
    ['remember stores explicit facts', rem.learned.some((l) => /paypal/.test(l.text))],
    ['profile shows the new fact to the agent', prof.facts.some((f) => f.value === 'paypal')],
    ['invalid key is rejected (401)', unauthorized],
  ];
});

await step('11. MCP server — tools/list and brain_recall over stdio', async () => {
  const { spawn } = await import('node:child_process');
  const created = await call('/api/agents', { name: `E2E MCP ${LANG}`, domain: 'travel', kind: 'external' });
  const proc = spawn(process.execPath, [new URL('../mcp/server.mjs', import.meta.url).pathname], { env: { ...process.env, BRAIN_URL: BASE, BRAIN_API_KEY: created.apiKey, BRAIN_LANG: LANG } });
  const lines = [];
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const send = (m) => proc.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brain_recall', arguments: { customerId: CUSTOMER, text: S.flight } } });
  for (let k = 0; k < 50 && lines.length < 3; k++) await new Promise((r) => setTimeout(r, 100));
  proc.kill();
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  const recallText = byId[3]?.result?.content?.[0]?.text || '';
  return [
    ['initialize handshake', byId[1]?.result?.serverInfo?.name === 'agent-brain-hub'],
    ['4 brain tools exposed', byId[2]?.result?.tools?.length === 4, byId[2]?.result?.tools?.map((x) => x.name).join(', ')],
    ['brain_recall returns traceId + memory context', /traceId: recall-/.test(recallText) && /Semantic memory/.test(recallText)],
  ];
});

const passed = results.filter((r) => r.ok).length;
console.log(`\n${'─'.repeat(60)}\n${passed === results.length ? '🎉' : '⚠️'}  ${passed}/${results.length} steps passed · ${(results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1)}s total`);
process.exit(passed === results.length ? 0 : 1);
