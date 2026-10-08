#!/usr/bin/env node
// Retrieval latency with a large memory. Not a quality benchmark: it seeds many
// customers' episodes and facts, then times recall() for one customer.
//   npm run bench:scale                      20,000 episodes over 200 customers
//   npm run bench:scale -- --episodes 100000 --customers 1000
import { performance } from 'node:perf_hooks';
import { Brain } from '../server/brain/index.js';
import { Store } from '../server/store.js';
import { NeuralBus } from '../server/bus.js';
import { LLM } from '../server/llm.js';
import { addEpisode, writeFact } from '../server/brain/neocortex.js';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : def;
};
const EPISODES = opt('episodes', 20_000);
const CUSTOMERS = opt('customers', 200);
const QUERIES = opt('queries', 50);

const TOPICS = ['brake check', 'oil change', 'flight to Da Nang', 'hotel near the beach', 'vegetarian snacks', 'laptop screen repair', 'budget for the trip', 'window seat', 'running shoes size 42', 'dentist appointment'];
const b = new Brain({ store: new Store(null), bus: new NeuralBus(), llm: new LLM({ offline: true }), deterministic: true });
const t0 = performance.now();
for (let i = 0; i < EPISODES; i++) {
  const c = `c-${i % CUSTOMERS}`;
  addEpisode(b, { customerId: c, agentId: 'kai', ownerDomain: 'repair', scope: 'shared', kind: 'session', text: `Session ${i}: customer asked about ${TOPICS[i % TOPICS.length]} (${i % 37})` });
  if (i % 10 === 0) writeFact(b, { entity: 'customer', relation: 'prefers', value: `${TOPICS[(i / 10) % TOPICS.length]} ${i}` }, { agent: b.state.agents.find((a) => a.id === 'mia'), customerId: c });
}
const seedMs = performance.now() - t0;

const times = [];
for (let q = 0; q < QUERIES; q++) {
  const s = performance.now();
  await b.recall({ agentId: 'atlas', customerId: `c-${q % CUSTOMERS}`, text: `What did I ask about the ${TOPICS[q % TOPICS.length]}?`, lang: 'en' });
  times.push(performance.now() - s);
}
times.sort((x, y) => x - y);
const p = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(2);
console.log(`episodes=${b.state.episodes.length} facts=${b.state.facts.length} customers=${CUSTOMERS} seed=${(seedMs / 1000).toFixed(1)}s`);
console.log(`recall p50=${p(0.5)} ms  p95=${p(0.95)} ms  (${QUERIES} queries)`);
