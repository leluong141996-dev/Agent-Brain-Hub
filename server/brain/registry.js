// Relation registry (v0.7): the ontology as data. The 19 core relations come
// from ontology.js; state.relations stores overrides of core entries (policy,
// ttlDays) and every relation learned at runtime. A new relation starts
// provisional: private to the domain that wrote it, short TTL, "latest wins".
// Admins promote, merge or delete it (Settings → Memory schema).
import { RELATIONS, setRelationLabel, relationLabel } from './ontology.js';
import { stripDiacritics, truncate } from '../text.js';

export const POLICIES = ['latest', 'owner', 'trust', 'human'];
export const MAX_PROVISIONAL = 200;
const SECRET = /(^|_)(password|passcode|passwd|pin|otp|cvv|api_?key|token|secret|seed_?phrase|private_?key)(_|$)/;
const ALIASES = {
  likes: 'prefers', like: 'prefers', home_city: 'lives_in', city: 'lives_in', hometown: 'lives_in',
  job: 'occupation', profession: 'occupation', allergy: 'allergic_to', allergies: 'allergic_to',
  kids: 'has_children', children: 'has_children', salary: 'income', monthly_income: 'income',
};
const DEFAULT_POLICY = { asset_unavailable: 'latest', budget: 'latest', trip_destination: 'latest', prefers_seat: 'latest', clothing_size: 'latest', income: 'owner', payment_method: 'owner' };

export function normalizeName(raw) {
  let n = stripDiacritics(String(raw || '')).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '');
  n = n.replace(/^favorite_/, 'favourite_').replace(/(^|_)color$/, '$1colour');
  return ALIASES[n] || n;
}

function core(name) {
  const r = RELATIONS[name];
  if (!r) return null;
  return { name, entity: r.entity, card: r.card, scope: r.scope, owner: r.writer, ttlDays: r.ttlDays ?? null, label: r.label, opposite: r.opposite || null, status: 'core', policy: DEFAULT_POLICY[name] || 'trust' };
}

// The effective definition of a relation, or null if the brain doesn't know it.
export function relationOf(B, name) {
  const saved = B.state.relations?.[name];
  const base = core(name);
  if (!base) return saved || null;
  if (!saved) return base;
  return { ...base, policy: saved.policy ?? base.policy, ttlDays: saved.ttlDays !== undefined ? saved.ttlDays : base.ttlDays };
}

function touch(B, name, customerId, value) {
  const r = B.state.relations[name];
  r.uses += 1;
  r.lastSeen = B.clock.now();
  if (customerId && !r.customers.includes(customerId) && r.customers.length < 50) r.customers.push(customerId);
  const ex = truncate(String(value || ''), 40);
  if (ex && r.examples.length < 3 && !r.examples.includes(ex)) r.examples.push(ex);
}

// Look up a relation for a write, creating a provisional one if it is new.
export function ensureRelation(B, raw, { agent, customerId, value, label = null }) {
  const name = normalizeName(raw);
  if (!name || name.length < 2) return { error: 'invalid', name };
  if (SECRET.test(name)) return { error: 'secret', name };
  const known = relationOf(B, name);
  if (known) {
    if (known.status !== 'core') touch(B, name, customerId, value);
    return { rel: relationOf(B, name), name };
  }
  const regs = (B.state.relations ||= {});
  if (Object.values(regs).filter((r) => r.status === 'provisional').length >= MAX_PROVISIONAL) return { error: 'registry_full', name };
  const now = B.clock.now();
  regs[name] = { name, entity: 'customer', card: 'one', scope: 'private', owner: agent.domain, ttlDays: 30, label, opposite: null, status: 'provisional', policy: 'latest', uses: 0, customers: [], examples: [], firstSeen: now, lastSeen: now };
  if (label) setRelationLabel(name, label);
  touch(B, name, customerId, value);
  return { rel: regs[name], name, created: true };
}

export const worthReview = (r) => r.status === 'provisional' && ((r.customers?.length || 0) >= 3 || (r.uses || 0) >= 5);

export function listRelations(B, lang) {
  const names = new Set([...Object.keys(RELATIONS), ...Object.keys(B.state.relations || {})]);
  return [...names].map((n) => {
    const r = relationOf(B, n);
    return { ...r, labelText: relationLabel(n, lang), worthReview: worthReview(r) };
  });
}

// Register labels of saved relations (labels live in a module map, see ontology.js).
export function loadRegistry(B) {
  B.state.relations ||= {};
  for (const r of Object.values(B.state.relations)) if (r.label) setRelationLabel(r.name, r.label);
}
