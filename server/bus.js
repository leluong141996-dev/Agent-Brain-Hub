// Neural event bus. Every brain region reports what it does as a "step";
// the visualizer subscribes over SSE and animates the signal flow.
import { EventEmitter } from 'node:events';

export class NeuralBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.log = [];
  }

  // A trace groups the steps of one awake turn or one sleep cycle.
  trace(kind, meta = {}) {
    const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const started = performance.now();
    const steps = [];
    let last = null;
    const bus = this;
    const lang = ['vi', 'en', 'ja'].includes(meta.lang) ? meta.lang : 'vi';
    const t = {
      id,
      kind,
      lang,
      steps,
      // L('tiếng Việt', 'English', '日本語') → label in the trace's language
      L: (vi, en, ja) => (lang === 'en' ? en : lang === 'ja' ? ja ?? en : vi),
      // from: region the signal comes from (defaults to the previous step's region)
      step(region, label, detail = {}, opts = {}) {
        const s = {
          traceId: id,
          kind,
          seq: steps.length,
          region,
          from: opts.from === undefined ? last : opts.from,
          label,
          detail,
          status: opts.status || 'ok',
          t: Math.round((performance.now() - started) * 10) / 10,
        };
        steps.push(s);
        last = region;
        bus.emit('step', s);
        return s;
      },
      end(summary = {}) {
        const e = { traceId: id, kind, type: 'end', summary, ms: Math.round(performance.now() - started) };
        bus.emit('trace-end', e);
        return e;
      },
    };
    this.emit('trace-start', { traceId: id, kind, meta });
    return t;
  }

  // Corpus-callosum style cross-agent events (handoff, write delegation...).
  publish(topic, payload) {
    const ev = { topic, payload, at: Date.now() };
    this.log.push(ev);
    if (this.log.length > 200) this.log.shift();
    this.emit('bus', ev);
    return ev;
  }
}
