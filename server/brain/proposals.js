// Proposals (v0.8): during sleep, an LLM reads both sides of an open conflict
// (values, who wrote them, what the customer said, recent conversations) and
// suggests which value to keep. It is advice only: a person accepts it on the
// Review page. Each pair is asked once; "unsure" is remembered too. A proposal
// belongs to a pair of fact ids, so a changed conflict gets a fresh one.
import { stateAt } from './temporal.js';
import { relationLabel } from './ontology.js';
import { truncate } from '../text.js';

export const MAX_PROPOSALS_PER_SLEEP = 5;
const pairKey = (a, b) => [a.id, b.id].sort().join('|');

// Older value first; facts written in the same instant keep their write order.
export function olderFirst(B, a, b) {
  const d = (a.createdAt ?? 0) - (b.createdAt ?? 0);
  return d < 0 || (d === 0 && B.state.facts.indexOf(a) <= B.state.facts.indexOf(b)) ? [a, b] : [b, a];
}

// The current proposal of a conflict pair, or null.
export function proposalOf(a, b) {
  const p = a.proposal;
  return p && p.pair === pairKey(a, b) && b.proposal?.pair === p.pair ? p : null;
}

// Open conflict pairs of a customer, older value first.
export function conflictPairs(B, customerId, now = B.clock.now()) {
  const seen = new Set();
  const pairs = [];
  for (const f of B.state.facts) {
    if (f.customerId !== customerId || seen.has(f.id) || !f.conflictWith || stateAt(f, now) !== 'conflicted') continue;
    const o = B.state.facts.find((x) => x.id === f.conflictWith);
    if (!o || stateAt(o, now) !== 'conflicted') continue;
    seen.add(f.id).add(o.id);
    pairs.push(olderFirst(B, o, f));
  }
  return pairs;
}

export async function proposeResolutions(B, t, { customerId }) {
  if (!B.llm.available || typeof B.llm.proposeResolution !== 'function') return [];
  const made = [];
  for (const [a, b] of conflictPairs(B, customerId)) {
    if (made.length >= MAX_PROPOSALS_PER_SLEEP) break;
    if (proposalOf(a, b)) continue;
    // Conversations the owner domain of these facts may see (never another
    // domain's private sessions).
    const episodes = B.state.episodes
      .filter((e) => e.customerId === customerId && e.kind === 'session' && (e.scope !== 'private' || e.ownerDomain === a.ownerDomain))
      .sort((x, y) => y.createdAt - x.createdAt)
      .slice(0, 5)
      .map((e) => truncate(e.text, 240));
    const side = (f) => ({ value: f.value, agent: B.agentName(f.sourceAgentId), evidence: f.evidence, at: new Date(f.createdAt).toISOString() });
    const r = await B.llm.proposeResolution({ relation: relationLabel(a.relation, 'en'), a: side(a), b: side(b), episodes }, t.lang);
    if (!r) continue;
    const proposal = { pair: pairKey(a, b), keepId: r.keep === 'a' ? a.id : r.keep === 'b' ? b.id : null, reason: r.reason, model: B.llm.model || null, at: B.clock.now() };
    a.proposal = proposal;
    b.proposal = proposal;
    made.push({ a, b, proposal });
  }
  if (made.length) {
    t.step('dmn', t.L(`Đề xuất giải ${made.length} mâu thuẫn (chờ người duyệt)`, `Proposed how to settle ${made.length} conflicts (waiting for a person)`, `${made.length}件の矛盾に解決案（人の確認待ち）`), {
      proposals: made.map(({ a, b, proposal }) => `${a.relation}: ${proposal.keepId ? `keep "${proposal.keepId === a.id ? a.value : b.value}"` : 'unsure'} vs "${proposal.keepId === a.id ? b.value : a.value}"`),
    }, { from: 'neocortex' });
  }
  return made;
}
