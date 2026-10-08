// In-process target: a fresh Brain per scenario, offline and deterministic by
// default. Runs one automatic-sleep pass after every step, as production would.
import { Brain } from '../../../server/brain/index.js';
import { Store } from '../../../server/store.js';
import { NeuralBus } from '../../../server/bus.js';
import { LLM } from '../../../server/llm.js';
import { SleepScheduler, SLEEP_DEFAULTS } from '../../../server/brain/sleepScheduler.js';

const DAY = 86_400_000;
const DEFAULT_CUSTOMER = 'kh-001';

export class InProcessTarget {
  // embedder: optional; the target then waits for model vectors after every
  // write, so a run with a given model is reproducible.
  constructor({ lang = 'en', llm = null, embedder = null } = {}) {
    this.lang = lang;
    this.brain = new Brain({ store: new Store(null), bus: new NeuralBus(), llm: llm || new LLM({ offline: true }), deterministic: true, embedder });
    // Idle and pressure triggers follow the simulated clock; nightly follows the
    // wall clock, so it is off to keep runs reproducible.
    this.scheduler = new SleepScheduler(() => this.brain, { defaults: { ...SLEEP_DEFAULTS, nightly: false } });
  }

  async say(agent, text, customer = DEFAULT_CUSTOMER) {
    const r = await this.brain.think({ agentId: agent, customerId: customer, text, lang: this.lang });
    return { reply: r.reply, learned: r.learned };
  }

  async recall(agent, text, customer = DEFAULT_CUSTOMER) {
    const r = await this.brain.recall({ agentId: agent, customerId: customer, text, lang: this.lang, diagnostics: true });
    return { memories: r.memories, promptBlock: r.promptBlock, diagnostics: r.diagnostics };
  }

  async advance(ms) {
    this.brain.advanceClock(ms / DAY);
    await this.settle();
  }

  async sleep(customer = DEFAULT_CUSTOMER) {
    await this.brain.sleep({ customerId: customer, lang: this.lang, trigger: 'manual' });
    await this.settle();
  }

  // Background work that production does between requests: one automatic-sleep
  // pass and, with embeddings, indexing new memories. The runner calls it after
  // timing a step, so latency figures don't include it.
  async settle() {
    await this.scheduler.tick();
    if (this.brain.embedder?.available) await this.brain.embedQueue.drain({ throwOnError: true });
  }

  close() {
    this.brain.close();
  }
}
