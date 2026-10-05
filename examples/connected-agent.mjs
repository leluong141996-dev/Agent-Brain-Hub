// A connected agent: it runs OUTSIDE the hub and brings its own LLM, but
// shares the hub's memory. Run it while the hub UI is open to watch the
// brain light up and the conversation appear in the chat panel.
//
//   1. In the hub UI → "Agents & integrations" → create a CONNECTED agent, copy its key
//   2. BRAIN_API_KEY=abk_... node examples/connected-agent.mjs
//      (optional) OWN_LLM_URL=http://localhost:8000/v1 OWN_LLM_MODEL=qwen3-4b  → use a real LLM
//      (optional) LANG=en|vi|ja  CUSTOMER=kh-001
import { BrainClient } from '../sdk/brain-client.js';

const brain = new BrainClient({ url: process.env.BRAIN_URL || 'http://localhost:4317', apiKey: process.env.BRAIN_API_KEY });
const lang = process.env.LANG_CODE || process.env.BRAIN_LANG || 'vi';
const customerId = process.env.CUSTOMER || 'kh-001';

const SCRIPT = {
  vi: ['Chào bạn, tôi muốn gia hạn gói bảo hành cho laptop', 'Laptop của tôi là MacBook Air, tôi thanh toán bằng thẻ tín dụng'],
  en: ['Hi, I want to extend the warranty on my laptop', 'My laptop is a MacBook Air and I pay with credit card'],
  ja: ['こんにちは、ノートパソコンの保証を延長したいです', 'パソコンはマックブックエアです。クレジットカードで払います'],
}[lang];

// The agent's OWN model. Any OpenAI-compatible server works; without one we use a stub.
async function ownLLM(system, user) {
  if (!process.env.OWN_LLM_URL) return `(stub reply) Noted: "${user}". I used ${system.split('\n').length} lines of shared memory.`;
  const res = await fetch(`${process.env.OWN_LLM_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OWN_LLM_MODEL || 'qwen3-4b',
      messages: [{ role: 'system', content: `You are Lumi, a warranty & after-sales agent.\n${system}` }, { role: 'user', content: user }],
      max_tokens: 300,
      temperature: 0.4,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '(empty reply)';
}

const me = await brain.me();
console.log(`🔌 Connected as ${me.name} (${me.domain}, ${me.kind}) · customer ${customerId} · lang ${lang}\n`);

for (const text of SCRIPT) {
  console.log(`🧑 ${text}`);
  const ctx = await brain.recall({ customerId, text, lang });
  console.log(`   🧠 recall: intent=${ctx.intent.intent} · ${ctx.memories.length} memories · priority=${ctx.salience.priority}`);
  for (const m of ctx.memories.slice(0, 4)) console.log(`      • [${m.kind}/${m.scope}${m.from ? ` from ${m.from}` : ''}] ${m.text.slice(0, 90)}`);
  const reply = await ownLLM(ctx.promptBlock, ctx.redactedText);
  console.log(`🤖 ${reply}`);
  const r = await brain.remember({ traceId: ctx.traceId, reply, lang });
  console.log(`   🧬 learned: ${r.learned.map((l) => `${l.text} (${l.action})`).join(' · ') || '—'}\n`);
}
