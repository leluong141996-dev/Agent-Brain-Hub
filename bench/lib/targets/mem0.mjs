// Mem0 target: runs the scenarios against Mem0 open source (through
// bench/adapters/mem0_bridge.py), to compare memory systems on the same
// multi-agent scenarios. Black-box: only Mem0's public add / search.
//
// Mem0 has no per-relation privacy, so two configurations are measured and
// both are reported:
//   shared   - every agent searches the customer's whole memory (sharing works; private data can leak)
//   isolated - each agent searches only what it wrote (nothing leaks; nothing is shared either)
//
// What the scenarios do that Mem0 cannot express is reported as not applicable,
// never as a failure: a simulated clock (stale and temporal scenarios, asOf),
// and the hub's admin and maintenance operations (correct, forget, promote).
// `conflict` checks look for the hub's conflict flag; Mem0 resolves a
// contradiction by updating instead, so they are not counted for Mem0.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(here, '..', '..', 'adapters', 'mem0_bridge.py');
let seq = 0;

class Bridge {
  constructor(python) {
    this.proc = spawn(python, ['-u', BRIDGE], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.lines = readline.createInterface({ input: this.proc.stdout });
    this.queue = [];
    this.lines.on('line', (l) => {
      let msg;
      try { msg = JSON.parse(l); } catch { return; } // library noise on stdout
      if (msg.ready) { this.info = msg; this.onReady?.(); return; }
      this.queue.shift()?.(msg);
    });
    this.ready = new Promise((r, j) => { this.onReady = r; this.proc.on('exit', (c) => j(new Error(`mem0 bridge exited (${c})`))); });
  }
  call(req) {
    return new Promise((resolve, reject) => {
      this.queue.push((msg) => (msg.ok ? resolve(msg.results) : reject(new Error(`mem0: ${msg.error}`))));
      this.proc.stdin.write(JSON.stringify(req) + '\n');
    });
  }
  close() { this.proc.stdin.end(); }
}

let bridge = null;
export async function startMem0({ python = process.env.MEM0_PYTHON || 'python3' } = {}) {
  bridge ||= new Bridge(python);
  await bridge.ready;
  return bridge.info;
}
export function stopMem0() { bridge?.close(); bridge = null; }

const CLOCK = new Set(['stale', 'temporal']);
const UNSUPPORTED = ['mark', 'correct', 'forget', 'promote'];

export class Mem0Target {
  constructor({ mode = 'shared', scenarioId = 'scenario', run = Date.now().toString(36) }) {
    if (!['shared', 'isolated'].includes(mode)) throw new Error('mem0 mode must be shared or isolated');
    this.mode = mode;
    this.base = `bench-${run}-${scenarioId}-${++seq}`;
  }

  // Why a scenario cannot be run on Mem0, or null.
  static notApplicable(s) {
    if (s.hubOnly) return s.hubOnly;
    if (CLOCK.has(s.category)) return 'needs a simulated clock';
    const step = s.steps.find((st) => UNSUPPORTED.some((k) => st[k] !== undefined) || st.asOf !== undefined);
    if (step) return `uses ${UNSUPPORTED.find((k) => step[k] !== undefined) || 'asOf'}`;
    return null;
  }
  static counts(checkType) { return checkType !== 'conflict'; }

  user(name) { return name ? `${this.base}-${name}` : this.base; }

  async say(agent, text, customer) {
    await bridge.call({ op: 'add', user_id: this.user(customer), agent_id: agent, text });
    return { reply: '' };
  }

  async remember(agent, body, customer) {
    for (const f of body.facts || []) await bridge.call({ op: 'add', user_id: this.user(customer), agent_id: agent, text: `${f.relation.replace(/_/g, ' ')}: ${f.value}`, infer: false });
  }

  async recall(agent, text, customer) {
    const results = await bridge.call({ op: 'search', user_id: this.user(customer), agent_id: this.mode === 'isolated' ? agent : undefined, query: text, limit: 10 });
    const memories = results.map((r) => ({ text: r.memory, score: r.score }));
    return { memories, promptBlock: memories.map((m) => `- ${m.text}`).join('\n') };
  }

  async advance() {} // sessions only; scenarios that need real time are not applicable
  async sleep() {}
  async now() { return Date.now(); }
}
