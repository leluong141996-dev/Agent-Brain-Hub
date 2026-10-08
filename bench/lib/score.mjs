// Scoring: compare what a target exposed (recall payload, replies) with what a
// scenario expects. Pure functions — no brain internals are used here.

// Case-insensitive substring, or a regex written as "/pattern/flags".
export function matches(text, pattern) {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(pattern);
  if (m) return new RegExp(m[1], m[2]).test(text);
  return String(text).toLowerCase().includes(String(pattern).toLowerCase());
}

const texts = (obs) => (obs.memories || []).map((m) => m.text);

// Each check: { type, pattern, passed, counted, observed }.
export function scoreRecall(expect = {}, obs) {
  const mem = texts(obs);
  const inMemories = (p) => mem.some((t) => matches(t, p));
  const out = [];
  for (const p of expect.remembers || []) out.push({ type: 'remembers', pattern: p, passed: inMemories(p) });
  for (const p of expect.private || []) out.push({ type: 'private', pattern: p, passed: !inMemories(p) && !matches(obs.promptBlock || '', p) });
  for (const p of expect.stale || []) out.push({ type: 'stale', pattern: p, passed: !inMemories(p) });
  for (const p of expect.conflict || []) out.push({ type: 'conflict', pattern: p, passed: (obs.memories || []).some((m) => m.conflicted && matches(m.text, p)) });
  return out.map((c) => ({ ...c, counted: true, observed: mem }));
}

// Offline replies come from templates, so reply checks only count with an LLM.
export function scoreSay(expect = {}, obs, { llm }) {
  const r = expect.reply;
  if (!r) return [];
  const reply = obs.reply || '';
  return [
    ...(r.includes || []).map((p) => ({ type: 'reply', pattern: p, passed: matches(reply, p) })),
    ...(r.excludes || []).map((p) => ({ type: 'reply', pattern: `not ${p}`, passed: !matches(reply, p) })),
  ].map((c) => ({ ...c, counted: !!llm, observed: [reply] }));
}
