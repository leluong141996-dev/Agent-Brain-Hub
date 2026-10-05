// Minimal i18n: every user-facing string is written as a {vi, en, ja} triple.
export const LANGS = ['vi', 'en', 'ja'];

export function normLang(lang) {
  return LANGS.includes(lang) ? lang : 'vi';
}

// L(lang, 'tiếng Việt', 'English', '日本語') — Japanese falls back to English.
export function L(lang, vi, en, ja) {
  if (lang === 'en') return en;
  if (lang === 'ja') return ja ?? en;
  return vi;
}

// Resolve a value that is either a plain string or a {vi, en, ja} object.
export function tr(value, lang) {
  if (value && typeof value === 'object') {
    const l = normLang(lang);
    return value[l] ?? (l === 'ja' ? value.en : undefined) ?? value.vi ?? value.en;
  }
  return value;
}

export const LANGUAGE_NAME = { vi: 'Vietnamese (tiếng Việt)', en: 'English', ja: 'Japanese (日本語)' };

// Locale tags for Intl formatting.
export const LOCALE = { vi: 'vi-VN', en: 'en-GB', ja: 'ja-JP' };
