// Local, dependency-free embedding: feature hashing over word unigrams,
// bigrams and character trigrams. Good enough to demo semantic retrieval
// offline; swap `embed()` for a real embedding API in production.
import { tokenize, norm } from './text.js';

export const DIM = 256;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function add(vec, feature, weight) {
  const h = hash(feature);
  vec[h % DIM] += (h & 0x80000000 ? -1 : 1) * weight;
}

export function embed(text) {
  const vec = new Float32Array(DIM);
  const toks = tokenize(text);
  toks.forEach((t, i) => {
    add(vec, 'w:' + t, 1);
    if (i > 0) add(vec, 'b:' + toks[i - 1] + '_' + t, 0.7);
  });
  const flat = norm(text).replace(/\s+/g, ' ');
  for (let i = 0; i < flat.length - 2; i++) add(vec, 'c:' + flat.slice(i, i + 3), 0.25);
  let n = 0;
  for (let i = 0; i < DIM; i++) n += vec[i] * vec[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) vec[i] /= n;
  return Array.from(vec, (x) => Math.round(x * 1e4) / 1e4);
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
