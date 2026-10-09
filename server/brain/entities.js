// Entity graph (v0.6). Facts are grouped into entities within one customer
// ("my car" = "chiếc xe" = "Honda Civic" → asset:car), and entities are linked
// by a relation-affinity table. RAS uses it to spread relevance from the facts
// a question matches to the facts connected to them (multi-hop retrieval).
//
// Customer profiles are never merged: resolution only groups facts that already
// belong to the same customer. Limit: one node per asset type per customer.
import { stripDiacritics } from '../text.js';

const ASSET_TYPES = {
  car: /\b(car|cars|vehicle|auto|sedan|suv|xe|o to|honda|civic|toyota|vios|camry|corolla|mazda|kia|hyundai|ford|vinfast|tesla|brakes?|engine|tyres?|tires?)\b|車|自動車|愛車|ブレーキ|エンジン|タイヤ/i,
  laptop: /\b(laptop|notebook|macbook|thinkpad|dell|xps|lenovo|asus|acer|may tinh)\b|パソコン|ノートパソコン/i,
  phone: /\b(phone|iphone|smartphone|galaxy|pixel|dien thoai)\b|スマホ|携帯/i,
  appliance: /\b(fridge|refrigerator|washing machine|washer|air conditioner|aircon|tu lanh|may giat|dieu hoa)\b|冷蔵庫|洗濯機|エアコン/i,
};

const PROFILE = { name: 'self', lives_in: 'self', occupation: 'self', has_children: 'self', prefers: 'self', dislikes: 'self', diet: 'self', clothing_size: 'self', prefers_seat: 'travel', allergic_to: 'health', health_condition: 'health', budget: 'finance', income: 'finance', payment_method: 'finance', policy: 'org' };

const slug = (s) => stripDiacritics(String(s).toLowerCase()).replace(/[^a-z0-9぀-鿿]+/g, '-').replace(/^-|-$/g, '') || 'unknown';

export function assetType(text) {
  const t = stripDiacritics(String(text).toLowerCase());
  for (const [type, re] of Object.entries(ASSET_TYPES)) if (re.test(t) || re.test(String(text))) return type;
  return 'other';
}

// The entity a fact is about, within its customer.
export function entityOf(f) {
  if (PROFILE[f.relation]) return PROFILE[f.relation];
  if (f.relation === 'trip_destination') return `trip:${slug(f.value)}`;
  if (f.relation === 'owns_asset' || f.relation === 'asset_issue' || f.relation === 'asset_unavailable') return `asset:${assetType(`${f.value} ${f.evidence || ''}`)}`;
  return 'self';
}

// Facts about the same concrete entity belong together (a car, a trip). The
// profile entities are hubs, so "same entity" does not spread through them.
export const CONCRETE = (id) => id.startsWith('asset:') || id.startsWith('trip:');

// Relations that matter together, whichever entity they belong to.
const AFFINITY = [
  ['trip_destination', 'asset_unavailable'], // getting there without a car
  ['trip_destination', 'lives_in'], // where the trip starts
  ['trip_destination', 'diet'], // meals on the way
  ['trip_destination', 'allergic_to'], // meals on the way (private: only the health domain ever sees it)
  ['trip_destination', 'budget'],
  ['trip_destination', 'prefers_seat'],
  ['trip_destination', 'has_children'],
  ['asset_issue', 'asset_unavailable'],
  ['owns_asset', 'asset_unavailable'],
  ['health_condition', 'allergic_to'],
  ['budget', 'payment_method'],
];
const AFF = new Map();
for (const [a, b] of AFFINITY) {
  AFF.set(`${a}|${b}`, true);
  AFF.set(`${b}|${a}`, true);
}

export const W_ENTITY = 0.6;
export const W_AFFINITY = 0.5;

// Edge weight between two facts of the same customer, or 0.
export function link(a, b) {
  if (a === b) return 0;
  const ea = entityOf(a);
  if (ea === entityOf(b) && CONCRETE(ea)) return W_ENTITY;
  return AFF.has(`${a.relation}|${b.relation}`) ? W_AFFINITY : 0;
}

// Entities a question mentions (entity linking on the query side): an asset
// type ("my car", "xe", "車"), or the name of a known entity ("Civic", "Tokyo").
const NAMED = new Set(['owns_asset', 'trip_destination']);
export function mentionedEntities(query, facts) {
  const q = ` ${stripDiacritics(String(query).toLowerCase())} `;
  const out = new Set();
  const type = assetType(query);
  if (type !== 'other') out.add(`asset:${type}`);
  for (const f of facts) {
    if (!NAMED.has(f.relation)) continue;
    const words = stripDiacritics(String(f.value).toLowerCase()).split(/[^a-z0-9\u3040-\u9fff]+/).filter((w) => w.length >= 4 || /[\u3040-\u9fff]/.test(w));
    if (words.some((w) => q.includes(` ${w} `) || q.includes(` ${w}?`) || q.includes(` ${w}'`) || (/[\u3040-\u9fff]/.test(w) && q.includes(w)))) out.add(entityOf(f));
  }
  return out;
}

export function affinityPairs() {
  return AFFINITY.map(([a, b]) => ({ a, b }));
}
