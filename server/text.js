// Text helpers tuned for Vietnamese, English and Japanese input.

export function stripDiacritics(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFC'); // re-compose so Japanese kana (dakuten) stay intact
}

// Lowercase, no diacritics, collapsed whitespace — used for keyword matching.
export function norm(s) {
  return stripDiacritics(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

// Japanese / CJK characters (hiragana, katakana, kanji, full-width forms).
export const CJK = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
const CJK_RUN = /[぀-ヿ㐀-鿿ｦ-ﾟー]+/g;

const STOPWORDS = new Set(
  'toi minh em anh chi ban la va cua co khong nhe a o thi ma voi cho de duoc rat nay do kia nhung cac mot nhu the nao gi i the is a an and or of to in on for my me you it this that be are was'.split(' ')
);
const JA_STOP = new Set(['です', 'ます', 'した', 'して', 'ので', 'から', 'まで', 'ください', 'でしょう', 'たい']);

// Latin words + Japanese character bigrams (Japanese has no spaces).
export function tokenize(s) {
  const n = norm(s);
  const out = n
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
  for (const run of n.match(CJK_RUN) || []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (!JA_STOP.has(bg)) out.push(bg);
    }
  }
  return out;
}

// Rough token estimate for context-budget accounting (CJK ≈ 1 token/char).
export function estimateTokens(s) {
  s = String(s || '');
  const cjk = (s.match(CJK_RUN) || []).join('').length;
  return Math.ceil((s.length - cjk) / 4 + cjk);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Keyword match. Latin: whole words, keeping diacritics when the text has them
// ("sổ" ≠ "sợ") and accent-insensitive for unaccented input. Japanese: plain
// substring (no word boundaries in Japanese).
export function includesAny(text, keywords) {
  const lower = String(text || '').normalize('NFC').toLowerCase();
  const accented = lower !== stripDiacritics(lower);
  const hay = accented ? lower : norm(lower);
  return keywords.filter((k) => {
    if (CJK.test(k)) return lower.includes(k);
    const key = (accented ? k.normalize('NFC').toLowerCase() : norm(k)).trim();
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(key)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(hay);
  });
}

// Normalized string similarity (Dice coefficient on bigrams).
export function similarity(a, b) {
  a = norm(a);
  b = norm(b);
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, c] of ga) overlap += Math.min(c, gb.get(g) || 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

export function truncate(s, n = 120) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
