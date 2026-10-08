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
  constructor({ lang = 'en', llm = null } = {}) {
    this.lang = lang;
    this.brain = new Brain({ store: new Store(null), bus: new NeuralBus(), llm: llm || new LLM({ offline: true }), deterministic: true });
    // Idle and pressure triggers follow the simulated clock; nightly follows the
    // wall clock, so it is off to keep runs reproducible.
    this.scheduler = new SleepScheduler(() => this.brain, { defaults: { ...SLEEP_DEFAULTS, nightly: false } });
  }

  async say(agent, text, customer = DEFAULT_CUSTOMER) {
    const r = await this.brain.think({ agentId: agent, customerId: customer, text, lang: this.lang });
    await this.scheduler.tick();
    return { reply: r.reply, learned: r.learned };
  }

  async recall(agent, text, customer = DEFAULT_CUSTOMER) {
    const r = this.brain.recall({ agentId: agent, customerId: customer, text, lang: this.lang, diagnostics: true });
    return { memories: r.memories, promptBlock: r.promptBlock, diagnostics: r.diagnostics };
  }

  async advance(ms) {
    this.brain.advanceClock(ms / DAY);
    await this.scheduler.tick();
  }

  async sleep(customer = DEFAULT_CUSTOMER) {
    await this.brain.sleep({ customerId: customer, lang: this.lang, trigger: 'manual' });
  }

  close() {}
}
