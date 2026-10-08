// Background backfill of model vectors. Writes never wait on the network: a
// fact or episode is stored with its hashing vector, and this queue later adds
// a vector from the configured embedding model (`vec`, `vecModel`). It also
// redoes items after the model changes.
import { factEmbedText } from './ontology.js';

const BATCH = 32;
const MIN_BACKOFF = 5_000;
const MAX_BACKOFF = 300_000;

export class EmbedQueue {
  constructor(brain, embedder) {
    this.brain = brain;
    this.embedder = embedder;
    this.running = null; // promise of the current run
    this.retryTimer = null;
    this.backoff = MIN_BACKOFF;
    this.lastError = null;
    this.waiters = [];
    // Long texts on a CPU model can make big batches time out while single
    // items succeed: the batch size halves on a timeout and stays there.
    this.batchSize = BATCH;
    this.timeoutMs = 120_000; // background work: generous, unlike query embedding
  }

  // Facts use the same multilingual text as their hashing vector.
  static textOf(x) {
    return x.relation ? factEmbedText(x) : x.text;
  }

  items() {
    return [...this.brain.state.facts, ...this.brain.state.episodes];
  }

  pending() {
    const model = this.embedder.modelId;
    return model ? this.items().filter((x) => x.vecModel !== model) : [];
  }

  status() {
    const model = this.embedder.modelId;
    const items = this.items();
    return {
      model,
      total: model ? items.length : 0,
      done: model ? items.filter((x) => x.vecModel === model).length : 0,
      running: !!this.running,
      lastError: this.lastError,
    };
  }

  // Called after memory writes and model changes. Cheap when there's no work.
  kick() {
    if (this.running || this.retryTimer || !this.embedder.available) return;
    if (!this.pending().length) return this.settle();
    this.running = this.run().finally(() => {
      this.running = null;
      // Work may have arrived (or the model changed) after the last check, while
      // `running` still blocked kick(). While a retry is scheduled, kick() is a no-op.
      if (this.pending().length) this.kick();
    });
  }

  async run() {
    for (;;) {
      const model = this.embedder.modelId;
      const batch = this.pending().slice(0, this.batchSize);
      if (!model || !batch.length) break;
      try {
        const vecs = await this.embedder.embedBatch(batch.map(EmbedQueue.textOf), { timeoutMs: this.timeoutMs });
        if (this.embedder.modelId !== model) continue; // model changed mid-flight: redo
        batch.forEach((x, i) => {
          x.vec = Array.from(vecs[i]);
          x.vecModel = model;
        });
        this.lastError = null;
        this.backoff = MIN_BACKOFF;
        this.brain.store.save();
      } catch (e) {
        if (this.batchSize > 1 && (e.name === 'TimeoutError' || /timeout|aborted/i.test(e.message))) {
          this.batchSize = Math.max(1, this.batchSize >> 1);
          continue;
        }
        this.lastError = e.message;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.kick();
        }, this.backoff);
        this.retryTimer.unref?.();
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
        this.settle(true);
        return;
      }
    }
    this.settle();
  }

  settle(errored = false) {
    const keep = [];
    for (const w of this.waiters) {
      if (!this.pending().length) w.resolve();
      else if (errored && w.throwOnError) w.reject(new Error(`embedding backfill failed: ${this.lastError}`));
      else if (errored && w.untilError) w.resolve();
      else keep.push(w);
    }
    this.waiters = keep;
  }

  // Resolves when every item has a vector for the current model. With
  // untilError it also resolves on an error; with throwOnError it rejects, so
  // a script fails loudly instead of waiting on a retry. Used by tests and the
  // benchmark.
  drain({ untilError = false, throwOnError = false } = {}) {
    if (!this.embedder.available || !this.pending().length) return Promise.resolve();
    if (this.lastError && this.retryTimer) {
      if (throwOnError) return Promise.reject(new Error(`embedding backfill failed: ${this.lastError}`));
      if (untilError) return Promise.resolve(); // already failing
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject, untilError, throwOnError });
      this.kick();
    });
  }

  stop() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
