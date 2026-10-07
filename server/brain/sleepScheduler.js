// Automatic sleep cycle. Besides the manual "Run sleep cycle" button, the brain
// sleeps on its own, the way people do:
//   - idle:     a customer's conversation has gone quiet (default 30 min, the same
//               gap the thalamus uses to open a new session) and turns are waiting
//               to be consolidated → a short nap for that customer.
//   - pressure: too many unconsolidated turns. Working memory keeps only the last
//               MAX_TURNS, so without this older turns would be dropped before they
//               ever reach long-term memory.
//   - nightly:  once a day at a set server-local time, for every customer active
//               since the previous night (forgetting and reflection catch up).
// All runs, manual or automatic, go through Brain.sleep(), which serializes them.
import { MAX_TURNS } from './prefrontal.js';

export const SLEEP_DEFAULTS = { enabled: true, idleMinutes: 30, maxPendingTurns: 24, nightly: true, nightlyAt: '03:00' };
const HISTORY = 20;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptySleepState() {
  return { config: null, lastNightly: null, lastNightlyClock: 0, history: [] };
}

// Environment variables are defaults; settings saved in the UI take precedence.
export function sleepDefaultsFromEnv(env = process.env) {
  const d = { ...SLEEP_DEFAULTS };
  if (env.BRAIN_SLEEP_AUTO !== undefined) d.enabled = !['0', 'false', 'off', 'no'].includes(String(env.BRAIN_SLEEP_AUTO).toLowerCase());
  if (env.BRAIN_SLEEP_IDLE_MINUTES) d.idleMinutes = Number(env.BRAIN_SLEEP_IDLE_MINUTES);
  if (env.BRAIN_SLEEP_MAX_PENDING) d.maxPendingTurns = Number(env.BRAIN_SLEEP_MAX_PENDING);
  if (env.BRAIN_SLEEP_NIGHTLY_AT) {
    d.nightly = env.BRAIN_SLEEP_NIGHTLY_AT !== 'off';
    if (d.nightly) d.nightlyAt = env.BRAIN_SLEEP_NIGHTLY_AT;
  }
  return normalizeSleepConfig(d, SLEEP_DEFAULTS);
}

const bad = (message) => Object.assign(new Error(message), { status: 400 });

export function normalizeSleepConfig(input = {}, base = SLEEP_DEFAULTS) {
  const c = { ...base };
  for (const k of ['enabled', 'nightly']) if (input[k] !== undefined) c[k] = Boolean(input[k]);
  const int = (k, min, max) => {
    if (input[k] === undefined || input[k] === '') return;
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw bad(`${k} must be a whole number from ${min} to ${max}`);
    c[k] = n;
  };
  int('idleMinutes', 5, 1440);
  // Below MAX_TURNS, otherwise turns could still be dropped before consolidation.
  int('maxPendingTurns', 6, MAX_TURNS - 2);
  if (input.nightlyAt !== undefined) {
    if (!TIME_RE.test(String(input.nightlyAt))) throw bad('nightlyAt must be HH:MM (24-hour)');
    c.nightlyAt = String(input.nightlyAt);
  }
  return c;
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export class SleepScheduler {
  // getBrain: the hub replaces its Brain on reset, so always ask for the current one.
  // now: wall-clock time for the nightly run (injectable for tests).
  constructor(getBrain, { defaults = SLEEP_DEFAULTS, intervalMs = 60_000, now = () => new Date() } = {}) {
    this.getBrain = getBrain;
    this.defaults = defaults;
    this.intervalMs = intervalMs;
    this.now = now;
    this.running = false;
    this.timer = null;
  }

  get brain() {
    return this.getBrain();
  }

  get state() {
    return this.brain.state.sleep;
  }

  get config() {
    return { ...this.defaults, ...(this.state.config || {}) };
  }

  configure(input) {
    this.state.config = normalizeSleepConfig(input, this.config);
    this.brain.store.save();
    return this.status();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((e) => console.error('[sleep] auto sleep failed:', e.message)), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // Customers whose turns are waiting, with the trigger that applies (if any).
  pending() {
    const B = this.brain;
    const cfg = this.config;
    const now = B.clock.now();
    const out = [];
    for (const wm of Object.values(B.state.working)) {
      const turns = (wm.turns || []).filter((x) => !x.consolidated).length;
      if (!turns) continue;
      const idleMinutes = Math.max(0, Math.floor((now - (wm.updatedAt || 0)) / 60_000));
      const trigger = turns >= cfg.maxPendingTurns ? 'pressure' : idleMinutes >= cfg.idleMinutes ? 'idle' : null;
      out.push({ customerId: wm.customerId, name: B.state.customers[wm.customerId]?.name || wm.customerId, turns, idleMinutes, trigger, lang: wm.lang });
    }
    return out;
  }

  nightlyDue() {
    const cfg = this.config;
    if (!cfg.nightly) return false;
    const s = this.state;
    const d = this.now();
    const today = dayKey(d);
    if (!s.lastNightly) {
      // First start: don't sleep the whole brain right away. If tonight's time has
      // passed, the first nightly run is tomorrow; otherwise it is later today.
      const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
      s.lastNightly = hhmm(d) >= cfg.nightlyAt ? today : dayKey(yesterday);
      s.lastNightlyClock = this.brain.clock.now();
      return false;
    }
    return s.lastNightly !== today && hhmm(d) >= cfg.nightlyAt;
  }

  // One scheduler pass. Returns the sleep results it produced.
  async tick() {
    if (this.running || !this.config.enabled) return [];
    this.running = true;
    try {
      const B = this.brain;
      const runs = [];
      for (const p of this.pending().filter((x) => x.trigger)) {
        runs.push(await B.sleep({ customerId: p.customerId, lang: p.lang, trigger: p.trigger }));
      }
      if (this.nightlyDue()) {
        const since = this.state.lastNightlyClock || 0;
        const active = Object.values(B.state.working).filter((wm) => (wm.updatedAt || 0) > since || (wm.turns || []).some((x) => !x.consolidated));
        for (const wm of active) runs.push(await B.sleep({ customerId: wm.customerId, lang: wm.lang, trigger: 'nightly' }));
        this.state.lastNightly = dayKey(this.now());
        this.state.lastNightlyClock = B.clock.now();
        B.store.save();
      }
      return runs;
    } finally {
      this.running = false;
    }
  }

  nextNightly() {
    const cfg = this.config;
    if (!cfg.enabled || !cfg.nightly) return null;
    const [h, m] = cfg.nightlyAt.split(':').map(Number);
    const d = this.now();
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
    if (this.state.lastNightly === dayKey(d) || next <= d) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  status() {
    return {
      config: this.config,
      defaults: this.defaults,
      saved: !!this.state.config,
      running: this.running,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nextNightly: this.nextNightly(),
      pending: this.pending(),
      history: this.state.history.slice(0, HISTORY).map((h) => ({ ...h, name: this.brain.state.customers[h.customerId]?.name || h.customerId })),
    };
  }
}

export function recordSleep(B, entry) {
  const h = B.state.sleep.history;
  h.unshift(entry);
  if (h.length > HISTORY) h.length = HISTORY;
}
