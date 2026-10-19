// Customer data (v0.8.1): export everything the brain holds about one customer,
// and erase it. Both are admin actions. The audit log is append-only and never
// truncated, so it keeps ids and counts (an `erase` entry is added) but never a
// value. Company-wide policies (customer "*") are not a customer's data.
import { scrubPatterns } from './neocortex.js';

const bad = (message, status) => Object.assign(new Error(message), { status });
const strip = ({ embedding, vec, vecModel, ...rest }) => rest;

function check(B, customerId) {
  if (customerId === '*') throw bad('"*" holds company-wide policies, not a customer\'s data', 400);
  const known = B.state.customers[customerId] || B.state.facts.some((f) => f.customerId === customerId) || B.state.episodes.some((e) => e.customerId === customerId) || B.state.working[customerId];
  if (!known) throw bad(`customer "${customerId}" not found`, 404);
}

export function exportCustomer(B, customerId) {
  check(B, customerId);
  const own = (x) => x.customerId === customerId;
  return {
    exportedAt: new Date(B.clock.now()).toISOString(),
    customer: B.state.customers[customerId] || { id: customerId },
    // Every fact with its history (replaced, corrected, outvoted…), not only what is current.
    facts: B.state.facts.filter(own).map(strip),
    episodes: B.state.episodes.filter(own).map(strip),
    working: B.state.working[customerId] || null,
    insights: B.state.insights.filter(own),
    decisions: (B.state.decisions || []).filter(own),
    // Writes the memory firewall is holding for review: not memories yet.
    held: (B.state.quarantine || []).filter(own).map(({ input, ...h }) => h),
  };
}

export function eraseCustomer(B, customerId) {
  check(B, customerId);
  const s = B.state;
  const mine = (x) => x.customerId === customerId;
  const values = [...new Set(s.facts.filter(mine).flatMap((f) => [f.value, ...Object.values(f.valueI18n || {})]).map((v) => String(v).trim()).filter(Boolean))];
  const patterns = scrubPatterns(values);
  const hasValue = (text) => patterns.some((re) => String(text).replace(re, '') !== String(text));
  const counts = {
    facts: s.facts.filter(mine).length,
    episodes: s.episodes.filter(mine).length,
    turns: s.working[customerId]?.turns?.length || 0,
    insights: s.insights.filter(mine).length,
    traces: Object.values(s.traces).filter(mine).length,
    decisions: (s.decisions || []).filter(mine).length,
    held: (s.quarantine || []).filter(mine).length,
  };
  s.facts = s.facts.filter((f) => !mine(f));
  s.episodes = s.episodes.filter((e) => !mine(e));
  s.insights = s.insights.filter((i) => !mine(i));
  s.decisions = (s.decisions || []).filter((d) => !mine(d));
  s.quarantine = (s.quarantine || []).filter((h) => !mine(h));
  for (const [id, rec] of Object.entries(s.traces)) if (mine(rec)) delete s.traces[id];
  delete s.working[customerId];
  delete s.customers[customerId];
  if (s.sleep?.history) s.sleep.history = s.sleep.history.filter((h) => h.customerId !== customerId);
  // Learned relations are shared across customers and stay; what points at this one goes.
  for (const rel of Object.values(s.relations || {})) {
    if (rel.customers) rel.customers = rel.customers.filter((c) => c !== customerId);
    if (rel.examples) rel.examples = rel.examples.filter((ex) => !hasValue(ex));
  }
  // The live event log: events about this customer, or carrying one of its values.
  const quoted = `"${customerId}"`;
  const before = B.bus.log.length;
  B.bus.log = B.bus.log.filter((ev) => {
    const json = JSON.stringify(ev.payload ?? {});
    return !json.includes(quoted) && !hasValue(json);
  });
  counts.events = before - B.bus.log.length;
  B.memoryIndex?.sync?.('facts');
  return counts;
}
