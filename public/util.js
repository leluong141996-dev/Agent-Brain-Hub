// Shared helpers for the hub UI.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function adminToken() {
  try {
    return localStorage.getItem('brain.adminToken') || '';
  } catch {
    return '';
  }
}

// Admin API call. If the hub is protected by BRAIN_ADMIN_TOKEN, ask once.
export async function api(path, body, method) {
  const headers = { 'x-admin-token': adminToken() };
  const init = body === undefined && !method ? { headers } : { method: method || 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  const res = await fetch(path, init);
  if (res.status === 401 && path.startsWith('/api/')) {
    const token = window.prompt('Admin token (BRAIN_ADMIN_TOKEN):');
    if (token) {
      try {
        localStorage.setItem('brain.adminToken', token);
      } catch {}
      return api(path, body, method);
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const eventsUrl = () => `/api/events${adminToken() ? `?token=${encodeURIComponent(adminToken())}` : ''}`;

export async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (btn) {
    const old = btn.innerHTML;
    btn.innerHTML = btn.dataset.copied || '✓';
    setTimeout(() => (btn.innerHTML = old), 1400);
  }
}

export const fmtNum = (n, lang) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(LOCALES[lang] || 'en').format(n));
export const LOCALES = { vi: 'vi-VN', en: 'en-GB', ja: 'ja-JP' };
export const fmtDate = (ts, lang) => (ts ? new Date(ts).toLocaleDateString(LOCALES[lang]) : '∞');
export const fmtTime = (ts, lang) => new Date(ts).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Shared page header for the non-brain views.
export function pageHead(iconHtml, title, sub, actions = '') {
  return `<header class="page-head">
    <button class="icon-btn menu-btn" type="button" data-act="menu">${iconHtml}</button>
    <div class="page-title"><h1>${title}</h1><p>${sub}</p></div>
    <div class="page-actions">${actions}</div>
  </header>`;
}

// Lightweight toast notifications.
export function toast(html, kind = 'info', iconHtml = '') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${iconHtml}<div>${html}</div>`;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  }, 4200);
}
