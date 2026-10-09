// Agent Brain Hub — app shell (navigation, theme, language, menus) and the
// Live brain view. The Agents, Value and Audit views live in ./views/.
import { BrainMap, REGIONS, tx } from './brain.js';
import { $, $$, esc, api, eventsUrl, fmtDate, toast } from './util.js';
import { icon, hydrateIcons, avatar } from './icons.js';
import { LANGS, SCENARIOS, t, lang, loadLang, setCurrentLang } from './i18n.js';
import * as agentsView from './views/agents.js';
import * as valueView from './views/value.js';
import * as auditView from './views/audit.js';
import * as settingsView from './views/settings.js';

const store = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {}
  return null;
};

const ui = {
  snap: null,
  asOf: null, // v0.5: view memory as it was at this time (ms), or null for now
  view: 'brain',
  agentId: 'kai',
  customerId: store('brain.customer') || 'kh-001',
  tab: 'query',
  last: null, // last chat result (for the retrieval tab)
  trace: null, // { id, kind, steps, ms }
  openSpan: null,
  seen: new Set(),
  pending: new Map(), // traceId → render reply callback
  lastChatAgent: null,
  chatStarted: false,
};

const ctx = {
  ui,
  refresh: () => refresh(),
  goChat: (agentId) => {
    ui.agentId = agentId;
    location.hash = 'brain';
  },
};
const VIEWS = { agents: agentsView, value: valueView, audit: auditView, settings: settingsView };

// ======================= Theme =======================
function applyTheme(opt) {
  if (opt === 'light' || opt === 'dark') document.documentElement.dataset.theme = opt;
  else delete document.documentElement.dataset.theme;
  store('brain.theme', opt);
  $$('#themeSwitch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeOpt === opt)));
}

// ======================= Menus (popovers) =======================
function closeMenus(except) {
  $$('.popover').forEach((p) => {
    if (p !== except) p.hidden = true;
  });
  $$('[data-menu]').forEach((b) => b.setAttribute('aria-expanded', String(!!except && b.dataset.menu === except.id)));
}
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-menu]');
  if (trigger) {
    const pop = document.getElementById(trigger.dataset.menu);
    const open = pop.hidden;
    closeMenus(open ? pop : null);
    pop.hidden = !open;
    if (open) pop.querySelector('button, input')?.focus({ preventScroll: true });
    return;
  }
  if (!e.target.closest('.popover')) closeMenus();
  if (e.target.closest('[data-act=menu]')) $('#nav').classList.add('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenus();
    $('#nav').classList.remove('open');
  }
  const pop = e.target.closest?.('.popover');
  if (pop && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = $$('button', pop);
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  }
});
$('#navScrim').addEventListener('click', () => $('#nav').classList.remove('open'));

// ======================= i18n =======================
function applyStaticI18n() {
  document.documentElement.lang = lang();
  $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', t(el.dataset.i18nTitle));
  });
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $('#langCurrent').textContent = LANGS.find((l) => l.code === lang()).native;
  $('#langMenu').innerHTML = LANGS.map(
    (l) => `<button type="button" role="menuitemradio" class="lang-item" aria-checked="${l.code === lang()}" data-lang="${l.code}" lang="${l.code}">
      <span class="code">${l.short}</span><span>${esc(l.native)}<span class="item-sub">${esc(l.english)}</span></span>
      ${l.code === lang() ? `<span class="check">${icon('check')}</span>` : ''}</button>`
  ).join('');
  $$('#themeSwitch button').forEach((b) => {
    const label = t(`theme_${b.dataset.themeOpt}`);
    b.title = label;
    b.setAttribute('aria-label', label);
  });
  $$('#timeMenu [data-days]').forEach((b) => (b.innerHTML = `${icon('forward')}<span>${t('plus_days', { n: b.dataset.days })}</span>`));
  $('#promptMenu').innerHTML = SCENARIOS[lang()]
    .map(([label, agentId, text], i) => `<button type="button" class="popover-item" data-i="${i}" title="${esc(text)}">${icon('sparkles')}<span>${esc(label)}<span class="item-sub">${esc(agentName(agentId))}</span></span></button>`)
    .join('');
  renderCanvasHead();
  if (!ui.trace) renderTraceEmpty();
  if (!ui.chatStarted) renderChatEmpty();
}

async function setLang(code) {
  setCurrentLang(code);
  closeMenus();
  applyStaticI18n();
  brain.setLang(code);
  $('#regionCard').hidden = true;
  await refresh();
}

// ======================= Shell data =======================
function renderShell() {
  const s = ui.snap;
  const ms = $('#modelStatus');
  ms.className = `model-status ${s.llm.available ? (s.llm.lastError ? 'err' : 'on') : ''}`;
  ms.innerHTML = `<span class="pulse"></span><div><b>${esc(t('model'))}</b><span>${esc(s.llm.available ? s.llm.label : t('model_offline'))}</span></div>`;
  ms.title = s.llm.lastError ? t('model_err', { err: s.llm.lastError.slice(0, 160) }) : '';
  $('#navAgentCount').textContent = s.agents.length;
  $('#sleepBtn').title = s.autoSleep?.enabled ? t('sleep_btn_auto') : '';
  const sel = $('#customerSelect');
  if (!s.customers.some((c) => c.id === ui.customerId) && s.customers[0]) ui.customerId = s.customers[0].id;
  sel.innerHTML = s.customers.map((c) => `<option value="${esc(c.id)}" ${c.id === ui.customerId ? 'selected' : ''}>${esc(c.name)}${c.vip ? ' ★' : ''}</option>`).join('');
  const offset = Math.round((s.now - Date.now()) / 864e5);
  $('#clockValue').textContent = `${fmtDate(s.now, lang())}${offset ? ` (${t('days_offset', { n: offset })})` : ''}`;
  $('#vipToggle').checked = !!s.customers.find((c) => c.id === ui.customerId)?.vip;
}

// ======================= Routing =======================
function route() {
  const v = (location.hash || '#brain').slice(1);
  ui.view = ['brain', 'agents', 'value', 'audit', 'settings'].includes(v) ? v : 'brain';
  $$('.view').forEach((el) => (el.hidden = el.id !== `view-${ui.view}`));
  $$('#navLinks a').forEach((a) => (a.dataset.view === ui.view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#nav').classList.remove('open');
  closeMenus();
  renderCurrentView();
}

function renderCurrentView() {
  if (!ui.snap) return;
  if (ui.view === 'brain') {
    renderChatHead();
    renderTab();
  } else {
    VIEWS[ui.view].render($(`#view-${ui.view}`), ctx);
  }
}

async function refresh() {
  ui.snap = await api(`/api/state?customerId=${encodeURIComponent(ui.customerId)}&lang=${lang()}${ui.asOf ? `&asOf=${ui.asOf}` : ''}`);
  renderShell();
  renderCurrentView();
}

// ======================= Brain animation queue =======================
const brain = new BrainMap($('#brain'), { onSelect: showRegion });
const queue = [];
let running = false;
const speed = () => Number($('#speed').value);

function enqueue(item) {
  queue.push(item);
  if (!running) drain();
}

async function drain() {
  running = true;
  while (queue.length) {
    const item = queue.shift();
    if (item.type === 'start') startTrace(item.traceId, item.kind);
    else if (item.type === 'end') endTrace(item);
    else await playStep(item);
  }
  running = false;
}

const LOOP_KEY = { awake: 'loop_awake', sleep: 'loop_sleep', feedback: 'loop_feedback', recall: 'loop_recall', remember: 'loop_remember' };

function renderCanvasHead() {
  const chip = $('#loopBadge');
  const k = ui.trace?.kind;
  chip.className = `status-chip ${k ? `k-${k}` : ''} ${ui.trace && ui.trace.ms === undefined ? 'running' : ''}`;
  chip.textContent = t(k ? LOOP_KEY[k] || 'loop_awake' : 'loop_idle');
  if (!ui.trace) $('#caption').textContent = t('caption_idle');
  else if (ui.trace.ms !== undefined) $('#caption').textContent = t('caption_done', { n: ui.trace.steps.length, ms: ui.trace.ms });
  $('#traceMeta').textContent = ui.trace ? t('caption_done', { n: ui.trace.steps.length, ms: ui.trace.ms ?? '…' }) : '';
}

function renderTraceEmpty() {
  $('#traceList').innerHTML = `<li class="trace-empty">${esc(t('trace_empty'))}</li>`;
}

function startTrace(id, kind) {
  ui.trace = { id, kind, steps: [] };
  ui.openSpan = null;
  brain.reset();
  brain.setLoop(kind === 'sleep' ? 'sleep' : 'awake');
  $('#view-brain').classList.toggle('sleeping', kind === 'sleep');
  $('#traceList').innerHTML = '';
  renderCanvasHead();
}

async function playStep(step) {
  if (!ui.trace || ui.trace.id !== step.traceId) startTrace(step.traceId, step.kind);
  ui.trace.steps.push(step);
  const r = REGIONS[step.region] || { en: step.region };
  $('#caption').innerHTML = `<b>${esc(r.en)}</b> — ${esc(step.label)}`;
  $('#traceMeta').textContent = `${ui.trace.steps.length} · +${step.t} ms`;
  addSpan(step);
  if (step.region === 'output' && ui.pending.has(step.traceId)) {
    ui.pending.get(step.traceId)();
    ui.pending.delete(step.traceId);
  }
  // Animate only while the brain is on screen; otherwise just record the step.
  if (ui.view === 'brain' && !document.hidden) await brain.fire(step, speed());
}

function endTrace(e) {
  if (ui.pending.has(e.traceId)) {
    ui.pending.get(e.traceId)();
    ui.pending.delete(e.traceId);
  }
  if (ui.trace && ui.trace.id === e.traceId) ui.trace.ms = e.ms;
  renderCanvasHead();
  refresh();
}

const STATUS_ICON = { warn: 'alert', alert: 'alert', hit: 'zap' };

function addSpan(step) {
  const r = REGIONS[step.region] || { en: step.region, color: '#8a919e' };
  const li = document.createElement('li');
  li.className = 'span';
  li.dataset.region = step.region;
  li.style.setProperty('--c', r.color);
  const st = step.status && step.status !== 'ok' ? `<span class="st-${step.status}">${icon(STATUS_ICON[step.status] || 'info', 13)}</span>` : '';
  li.innerHTML = `<button type="button" class="span-row">
      <span class="span-idx">${step.seq + 1}</span><span class="span-dot"></span>
      <span class="span-main"><span class="span-name">${esc(r.en)}${st}</span><span class="span-label">${esc(step.label)}</span></span>
      <span class="span-time">+${step.t}ms</span>
    </button>`;
  li.querySelector('.span-row').onclick = () => toggleSpan(li, step);
  $('#traceList').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
}

function toggleSpan(li, step) {
  const wasOpen = li.classList.contains('open');
  $$('#traceList .span.open').forEach((x) => {
    x.classList.remove('open');
    x.querySelector('.span-detail')?.remove();
  });
  if (wasOpen) return;
  li.classList.add('open');
  li.insertAdjacentHTML('beforeend', `<div class="span-detail">${renderValue(step.detail)}</div>`);
}

function renderValue(v, depth = 0) {
  if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
  if (Array.isArray(v)) {
    if (!v.length) return '<span class="muted">—</span>';
    if (v.every((x) => typeof x !== 'object' || x === null)) return v.map((x) => `<span class="chip">${esc(x)}</span>`).join('');
    return `<ul>${v.map((x) => `<li>${renderValue(x, depth + 1)}</li>`).join('')}</ul>`;
  }
  if (typeof v === 'object') {
    if (depth > 0) {
      const flat = Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== '');
      if (flat.every(([, x]) => typeof x !== 'object')) return flat.map(([k, x]) => `<span class="chip"><b>${esc(k)}</b>${esc(x)}</span>`).join('');
    }
    return `<div class="kv">${Object.entries(v).map(([k, x]) => `<div class="k">${esc(k)}</div><div class="v">${renderValue(x, depth + 1)}</div>`).join('')}</div>`;
  }
  if (typeof v === 'boolean') return v ? icon('check', 14) : '—';
  return esc(v);
}

function showRegion(id) {
  const r = REGIONS[id];
  const L = lang();
  const card = $('#regionCard');
  const steps = (ui.trace?.steps || []).filter((s) => s.region === id);
  const loop = r.loop === 'awake' ? t('loop_a') : r.loop === 'sleep' ? t('loop_s') : t('loop_b');
  brain.select(id);
  card.style.setProperty('--c', r.color);
  card.innerHTML = `
    <button class="icon-btn sm close" aria-label="${esc(t('close'))}">${icon('x', 14)}</button>
    <h3>${esc(r.en)}</h3>
    <div class="sub">${esc(tx(r.name, L))}</div>
    <dl>
      <dt>${t('rc_role')}</dt><dd>${esc(tx(r.role, L))}</dd>
      ${r.service ? `<dt>${t('rc_service')}</dt><dd>${esc(tx(r.service, L))}</dd>` : ''}
      ${r.data ? `<dt>${t('rc_data')}</dt><dd>${esc(tx(r.data, L))}</dd>` : ''}
      ${r.tech ? `<dt>${t('rc_tech')}</dt><dd>${esc(tx(r.tech, L))}</dd>` : ''}
      ${r.loop ? `<dt>${t('rc_loop')}</dt><dd><span class="badge">${loop}</span></dd>` : ''}
      <dt>${t('rc_now')}</dt><dd>${steps.length ? steps.map((s) => `<div>${esc(s.label)}</div>`).join('') : `<span class="muted">${t('not_fired')}</span>`}</dd>
    </dl>`;
  card.hidden = false;
  card.querySelector('.close').onclick = () => {
    card.hidden = true;
    brain.select(null);
  };
  // Highlight the region's spans in the trace.
  const span = $(`#traceList .span[data-region="${id}"]`);
  if (span) span.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ======================= SSE =======================
function connect() {
  const es = new EventSource(eventsUrl());
  es.addEventListener('trace-start', (e) => {
    const d = JSON.parse(e.data);
    ui.seen.add(d.traceId);
    enqueue({ type: 'start', traceId: d.traceId, kind: d.kind });
    const why = d.kind === 'sleep' && d.meta?.trigger;
    if (why && why !== 'manual') {
      const customer = ui.snap?.customers?.find((c) => c.id === d.meta.customerId)?.name || d.meta.customerId;
      toast(esc(t('auto_slept', { why: t('trig_' + why), customer })), 'info', icon('moon'));
    }
  });
  es.addEventListener('step', (e) => enqueue(JSON.parse(e.data)));
  es.addEventListener('trace-end', (e) => enqueue({ type: 'end', ...JSON.parse(e.data) }));
  es.addEventListener('conversation', (e) => showApiConversation(JSON.parse(e.data)));
}

// Fallback when SSE missed a trace (e.g. proxy buffering): replay from response.
function ensurePlayed(result) {
  if (ui.seen.has(result.traceId)) return;
  enqueue({ type: 'start', traceId: result.traceId, kind: result.steps[0]?.kind || 'awake' });
  result.steps.forEach((s) => enqueue(s));
  enqueue({ type: 'end', traceId: result.traceId, ms: result.ms || 0 });
}

// ======================= Chat =======================
const agentById = (id) => ui.snap?.agents.find((a) => a.id === id);
const agentName = (id) => agentById(id)?.name || id;
const colorOf = (agent) => ui.snap?.domains[agent?.domain]?.color || '#6366f1';
const domainLabel = (agent) => ui.snap?.domains[agent?.domain]?.label || '';
const nowTime = () => new Date().toLocaleTimeString(lang() === 'vi' ? 'vi-VN' : lang() === 'ja' ? 'ja-JP' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

function renderChatHead() {
  const s = ui.snap;
  if (!agentById(ui.agentId)) ui.agentId = s.agents[0]?.id;
  const a = agentById(ui.agentId);
  const ext = a?.kind === 'external';
  $('#agentPicker').innerHTML = `${avatar(a?.name, colorOf(a), 34)}
    <span class="who"><b>${esc(a?.name)}${ext ? `<span class="badge info">${t('kind_external')}</span>` : ''}</b><span>${esc(domainLabel(a))}</span></span>
    ${icon('chevronDown', 16, 'caret')}`;
  $('#agentMenu').innerHTML = s.agents
    .map((x) => `<button type="button" class="popover-item" data-agent="${x.id}" role="menuitemradio" aria-checked="${x.id === ui.agentId}">
      ${avatar(x.name, colorOf(x), 28)}
      <span class="meta"><b>${esc(x.name)}${x.kind === 'external' ? `<span class="badge info">${t('kind_external')}</span>` : ''}</b><span class="item-sub">${esc(domainLabel(x))}${s.domains[x.domain]?.episodeScope === 'private' ? ' · private' : ''}</span></span>
      ${x.id === ui.agentId ? `<span class="check">${icon('check')}</span>` : ''}</button>`)
    .join('');
  $('#composer').classList.toggle('disabled', ext);
  $('#input').placeholder = t('input_ph', { name: a?.name || '' });
  const note = $('#composerNote');
  note.hidden = !ext;
  if (ext) note.innerHTML = `${icon('info', 14)}<span>${esc(t('connected_no_chat', { name: a.name }))}</span>`;
}

function renderChatEmpty() {
  $('#messages').innerHTML = `<div class="empty-state chat-empty">
    <div class="ico-tile">${icon('message', 20)}</div>
    <h3>${esc(t('chat_empty_title'))}</h3><p>${esc(t('chat_empty'))}</p>
    <button class="btn sm" type="button" data-menu="promptMenu">${icon('sparkles', 14)}<span>${esc(t('quick_prompts'))}</span></button>
  </div>`;
}

function startChat() {
  if (!ui.chatStarted) {
    $('#messages').innerHTML = '';
    ui.chatStarted = true;
  }
}

function divider(text) {
  startChat();
  const n = document.createElement('div');
  n.className = 'divider-note';
  n.textContent = text;
  $('#messages').appendChild(n);
  scrollChat();
}

const scrollChat = () => ($('#messages').scrollTop = 1e9);

function addUserMsg(text, api = false) {
  startChat();
  const div = document.createElement('div');
  div.className = 'msg user';
  div.innerHTML = `<div class="msg-body"><div class="bubble">${esc(text)}</div>${api ? `<div class="msg-meta"><span class="badge info">${icon('plug', 12)}${t('via_api')}</span></div>` : ''}</div>`;
  $('#messages').appendChild(div);
  scrollChat();
}

function addAgentMsg(agent, inner, cls = '') {
  startChat();
  const div = document.createElement('div');
  div.className = `msg agent ${cls}`;
  div.innerHTML = `${avatar(agent?.name, colorOf(agent), 28)}<div class="msg-body"><div class="msg-author">${esc(agent?.name)} <span class="time">${nowTime()}</span></div>${inner}</div>`;
  $('#messages').appendChild(div);
  scrollChat();
  return div;
}

function showApiConversation(c) {
  if (c.customerId !== ui.customerId) return;
  const agent = agentById(c.agentId) || { name: c.agentId };
  if (ui.lastChatAgent && ui.lastChatAgent !== c.agentId) divider(t('switch_note', { name: agent.name }));
  ui.lastChatAgent = c.agentId;
  if (c.user) addUserMsg(c.user, true);
  if (c.reply) addAgentMsg(agent, `<div class="bubble">${esc(c.reply)}</div><div class="msg-meta"><span class="badge info">${icon('plug', 12)}${t('via_api')}</span></div>`, 'api');
}

async function send(text, agentId = ui.agentId) {
  text = text.trim();
  if (!text) return;
  if (agentId !== ui.agentId) {
    ui.agentId = agentId;
    renderChatHead();
  }
  const agent = agentById(agentId);
  if (ui.lastChatAgent && ui.lastChatAgent !== agentId) divider(t('switch_note', { name: agent?.name }));
  ui.lastChatAgent = agentId;
  addUserMsg(text);
  const el = addAgentMsg(agent, `<div class="bubble"><span class="typing"><i></i><i></i><i></i></span>${esc(t('thinking'))}</div>`, 'thinking');
  $('#sendBtn').disabled = true;
  try {
    const r = await api('/api/chat', { agentId, customerId: ui.customerId, text, lang: lang() });
    ui.last = r;
    const render = () => renderReply(el, r);
    ui.pending.set(r.traceId, render);
    ensurePlayed(r);
    if (!running && !queue.length) {
      ui.pending.delete(r.traceId);
      render();
    }
  } catch (e) {
    el.classList.remove('thinking');
    el.querySelector('.msg-body').lastElementChild.outerHTML = `<div class="bubble">${icon('alert', 14)} ${esc(t('error'))}: ${esc(e.message)}</div>`;
  } finally {
    $('#sendBtn').disabled = false;
  }
}

const LEARN_ICON = { created: ['plus', ''], reinforced: ['check', 'info'], superseded: ['refresh', 'info'], conflict: ['alert', 'warn'], rejected: ['x', 'warn'] };

function renderReply(el, r) {
  el.classList.remove('thinking');
  const pr = r.salience.priority;
  const prBadge = pr === 'critical' || pr === 'high' ? 'danger' : pr === 'normal' ? '' : 'success';
  const meta = [
    `<span class="badge ${r.mode === 'playbook' ? 'success' : r.mode === 'reflex' ? 'danger' : 'accent'}">${t(r.mode === 'playbook' ? 'mode_playbook' : r.mode === 'reflex' ? 'mode_reflex' : 'mode_reasoning')}</span>`,
    `<span class="badge ${prBadge}">${esc(pr)}</span>`,
    `<span>${esc(r.intent.intent)}</span>`,
    `<span class="sep"></span><span>${t('memories', { n: r.retrieval.selected.length })}</span>`,
    r.handoff ? `<span class="sep"></span><span>${esc(t('handoff_from', { name: r.handoff.from }))}</span>` : '',
    r.redactions.length ? `<span class="sep"></span><span>${t('pii', { n: r.redactions.length })}</span>` : '',
    `<span class="sep"></span><span class="num">${r.ms} ms</span>`,
  ].join('');
  const learned = r.learned.length
    ? `<div class="msg-block"><div class="msg-block-title">${t('learned_title')}</div><ul class="learned-list">${r.learned
        .map((l) => {
          const [ic, cls] = LEARN_ICON[l.action] || ['plus', ''];
          return `<li class="${cls}">${icon(ic, 13)}<span>${esc(l.text)}${l.action !== 'created' ? ` <span class="muted">· ${esc(l.action)}</span>` : ''}</span></li>`;
        })
        .join('')}</ul></div>`
    : '';
  const sugg = r.actions.length
    ? `<div class="msg-block"><div class="msg-block-title">${t('suggestions_title')}</div><div class="suggestions">${r.actions
        .map((a) => `<div class="suggestion" data-trace="${r.traceId}" data-action="${a.id}">${icon('zap', 14)}<span class="label">${esc(a.label)}</span><span class="score">${a.score}</span>
          <span class="actions"><button class="btn sm" data-ok="1" title="${esc(t('accept'))}">${icon('thumbsUp', 13)}<span>${t('accept')}</span></button><button class="btn sm ghost icon-only" data-ok="0" title="${esc(t('decline'))}" aria-label="${esc(t('decline'))}">${icon('thumbsDown', 13)}</button></span></div>`)
        .join('')}</div></div>`
    : '';
  el.querySelector('.msg-body').innerHTML = `<div class="msg-author">${esc(r.agent.name)} <span class="time">${nowTime()}</span></div><div class="bubble">${esc(r.reply)}</div><div class="msg-meta">${meta}</div>${learned}${sugg}`;
  $$('.suggestion button', el).forEach((b) => {
    b.onclick = async () => {
      const item = b.closest('.suggestion');
      const ok = b.dataset.ok === '1';
      $$('button', item).forEach((x) => (x.disabled = true));
      try {
        const res = await api('/api/feedback', { traceId: item.dataset.trace, actionId: item.dataset.action, accepted: ok, lang: lang() });
        item.classList.add('done');
        item.querySelector('.actions').innerHTML = `<span class="badge ${ok ? 'success' : ''}">${icon(ok ? 'check' : 'x', 12)}${t(ok ? 'accepted' : 'declined')}</span>`;
        if (res.promoted) toast(esc(t('skill_learned', { name: res.promoted.name, v: res.promoted.version })), 'success', icon('book'));
      } catch {
        $$('button', item).forEach((x) => (x.disabled = false));
      }
    };
  });
  scrollChat();
  if (ui.tab === 'query') renderTab();
}

// ======================= Inspector tabs =======================
const scopeTag = (s) => `<span class="badge scope ${s}">${s}</span>`;
const tierTag = (x) => `<span class="badge tier ${x}">${x}</span>`;
const meter = (v, max = 1) => `<span class="meter"><i style="width:${Math.max(3, Math.min(100, (v / max) * 100))}%"></i></span>`;
const nameOf = (id) => (id ? (id === 'system' ? 'system' : agentById(id)?.name || id) : '—');
const emptyBox = (ic, text) => `<div class="empty-state"><div class="ico-tile">${icon(ic, 20)}</div><p>${esc(text)}</p></div>`;

const TABS = {
  query() {
    const r = ui.last;
    if (!r) return emptyBox('search', t('q_empty'));
    const hops = [];
    for (const s of r.steps) if (hops[hops.length - 1] !== s.region) hops.push(s.region);
    const path = hops.map((h) => `<span class="hop" style="--c:${REGIONS[h]?.color}"><i></i>${esc(REGIONS[h]?.en || h)}</span>`).join(`<span class="sep">${icon('chevronRight', 12)}</span>`);
    const rows = r.retrieval.selected
      .map((s) => `<tr><td><span class="badge">${s.kind}</span></td><td>${tierTag(s.tier)} <span class="muted small">${esc(s.latency)}</span></td><td>${scopeTag(s.scope)}</td><td>${esc(nameOf(s.source))}</td><td class="${s.status === 'conflicted' ? 'status-conflicted' : ''}">${esc(s.text)}</td><td class="num">${meter(s.score, 1.2)}${s.score}</td></tr>`)
      .join('');
    const ex = r.retrieval.excluded
      .slice(0, 30)
      .map((s) => `<tr class="dim"><td><span class="badge">${s.kind}</span></td><td colspan="3"><span class="badge danger">${icon('eyeOff', 12)}${esc(s.reason)}</span></td><td colspan="2">${esc(s.text)}</td></tr>`)
      .join('');
    const procedural = r.skill ? t('q_hit', { name: esc(r.skill.name), v: r.skill.version }) : t('q_miss');
    const query = r.steps.find((s) => s.region === 'ras')?.detail.query || '';
    return `
      <div class="section-label">${t('q_path')}</div>
      <div class="path">${path}</div>
      <div class="info-grid">
        <div class="info-card"><h4>${t('q_question')}</h4><div class="big">${esc(query)}</div><div class="muted small" style="margin-top:6px">intent <b class="text-2">${esc(r.intent.intent)}</b> · ${Math.round(r.intent.confidence * 100)}% · ${t('q_keywords')}: ${esc(r.intent.matched.join(', ') || '—')}</div></div>
        <div class="info-card"><h4>${t('q_order')}</h4><ol><li>${t('q_order_1')}</li><li>${procedural}</li><li>${t('q_order_3')} · <span class="num">${r.retrieval.ms} ms</span></li></ol></div>
        ${r.handoff ? `<div class="info-card"><h4>${esc(t('q_handoff', { from: r.handoff.from, to: r.handoff.to }))}</h4>${r.handoff.facts.map((f) => `<span class="chip">${esc(f)}</span>`).join('') || '—'}<div class="muted small" style="margin-top:6px">${t('q_withheld', { n: r.handoff.withheld })}</div></div>` : ''}
      </div>
      <table class="table"><thead><tr><th>${t('th_source')}</th><th>${t('th_tier')}</th><th>${t('th_scope')}</th><th>${t('th_from')}</th><th>${t('th_content')}</th><th class="num">${t('th_score')}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted">${t('q_none')}</td></tr>`}${ex}</tbody></table>`;
  },
  working() {
    const w = ui.snap?.working;
    if (!w) return emptyBox('layers', t('w_empty'));
    const journey = w.journey.map((j) => `<span class="hop" style="--c:${colorOf(agentById(j.agentId))}"><i></i>${esc(nameOf(j.agentId))} · ${esc(j.intent)}</span>`).join(`<span class="sep">${icon('chevronRight', 12)}</span>`);
    return `<div class="info-grid">
      <div class="info-card"><h4>${t('w_state')}</h4>${renderValue({ session: w.sessionId, language: w.lang, intent: w.intent, activeTask: w.activeTaskName, priority: w.salience?.priority, sentiment: w.salience?.sentiment })}</div>
      <div class="info-card"><h4>${t('w_journey')}</h4><div class="path" style="margin:0">${journey || '—'}</div></div>
      <div class="info-card"><h4>${t('w_outcomes')}</h4>${w.outcomes.slice(-6).map((o) => `<div class="small" style="display:flex;gap:6px;align-items:center;margin:3px 0">${icon(o.accepted ? 'check' : 'x', 13)}${esc(o.label)}</div>`).join('') || '<span class="muted">—</span>'}</div>
    </div>
    <div class="section-label">${t('w_turns', { n: w.turns.length })}</div>
    <table class="table"><tbody>${w.turns
      .slice(-12)
      .map((x) => `<tr><td style="white-space:nowrap">${x.role === 'user' ? `<span class="badge">${t('w_customer')}</span>` : `<span class="badge accent">${esc(nameOf(x.agentId))}</span>`}</td><td>${esc(x.text)}</td><td class="num">${x.consolidated ? `<span class="badge success">${t('w_consolidated')}</span>` : ''}</td></tr>`)
      .join('')}</tbody></table>`;
  },
  semantic() {
    const facts = ui.snap?.facts || [];
    if (!facts.length) return timeBar() + emptyBox('database', t('s_empty'));
    const past = !!ui.snap.asOf;
    return `${timeBar()}<table class="table"><thead><tr><th>${t('th_relation')}</th><th>${t('th_value')}</th><th>${t('th_scope')}</th><th>${t('th_writer')}</th><th>${t('th_from')}</th><th>${t('th_status')}</th><th>${t('th_conf')}</th><th>${t('th_exp')}</th><th></th></tr></thead><tbody>
      ${facts
        .map((f) => `<tr><td><code class="muted">${esc(f.entity)}.</code><code>${esc(f.relation)}</code></td><td class="status-${f.status}">${esc(f.displayValue)}</td><td>${scopeTag(f.scope)}</td><td>${esc(f.ownerDomain)}</td><td>${esc(nameOf(f.sourceAgentId))}</td>
        <td>${stateBadge(f.state)}${f.pinned ? ` <span class="badge accent">${t('st_pinned')}</span>` : ''}</td><td>${meter(f.confidence)}</td><td class="time-cell">${fmtDate(f.validUntil, lang())}</td>
        <td><div class="row-actions">${!past && f.state === 'conflicted' ? `<button class="btn sm" data-resolve="${f.id}">${t('keep_this')}</button>` : ''}${!past && f.customerId !== '*' ? `<button class="btn sm ghost" data-pin="${f.id}" data-pinned="${!f.pinned}">${f.pinned ? t('unpin') : t('pin')}</button>` : ''}${f.customerId !== '*' ? `<button class="btn sm ghost" data-history="${f.id}" title="${esc(t('hist_btn'))}">${icon('clock', 13)}</button>` : ''}</div></td></tr>
        <tr class="history-row" id="hist-${f.id}" hidden><td colspan="9"></td></tr>`)
        .join('')}
    </tbody></table>`;
  },
  graph() {
    return `${timeBar()}<div id="graphBox" class="graph-box"><div class="muted small">…</div></div>`;
  },
  episodic() {
    const eps = ui.snap?.episodes || [];
    if (!eps.length) return timeBar() + emptyBox('book', t('e_empty'));
    return `${timeBar()}<table class="table"><thead><tr><th>${t('th_kind')}</th><th>${t('th_tier')}</th><th>${t('th_scope')}</th><th>${t('th_content')}</th><th>${t('th_importance')}</th><th class="num">${t('th_access')}</th><th>${t('th_created')}</th><th>${t('th_exp')}</th></tr></thead><tbody>
      ${eps.map((e) => `<tr><td><span class="badge">${esc(e.kind)}</span></td><td>${tierTag(e.tier)}</td><td>${scopeTag(e.scope)}</td><td>${esc(e.text)}</td><td>${meter(e.importance)}</td><td class="num">${e.accessCount}</td><td class="time-cell">${fmtDate(e.createdAt, lang())}</td><td class="time-cell">${fmtDate(e.expiresAt, lang())}</td></tr>`).join('')}
    </tbody></table>`;
  },
  procedural() {
    const s = ui.snap;
    const skills = s.skills
      .map((k) => `<div class="info-card"><h4 style="display:flex;gap:6px;align-items:center;color:var(--text);font-size:13px;font-weight:600">${esc(k.name)} <span class="badge mono">v${k.version}</span>${scopeTag(k.scope)}${k.status !== 'active' ? '<span class="badge">deprecated</span>' : ''}</h4>
      <div class="muted small" style="margin-bottom:8px">${t('p_meta', { intent: esc(k.intent), domain: esc(k.domain), origin: esc(k.origin), uses: k.uses })}</div>
      <ol>${(k.stepLabels || k.steps).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      ${k.versions.length > 1 ? `<button class="btn sm" style="margin-top:10px" data-rollback="${k.id}">${icon('reset', 13)}${t('p_rollback', { v: k.versions[k.versions.length - 2].version })}</button>` : ''}</div>`)
      .join('');
    const patterns = s.patterns
      .map((p) => `<tr><td>${esc(s.domains[p.domain]?.label || p.domain)}</td><td><code>${esc(p.intent)}</code></td><td>${meter(Math.min(p.successes.length, 3), 3)}<span class="num">${p.successes.length}/3</span></td><td class="num">${p.failures}</td><td>${p.promoted ? `<span class="badge success">${t('p_promoted')}</span>` : `<span class="badge">${t('p_watching')}</span>`}</td></tr>`)
      .join('');
    return `<p class="hint">${t('p_rule')}</p>
      <div class="skill-grid">${skills}</div>
      <div class="section-label">${t('p_patterns')}</div>
      <table class="table"><thead><tr><th>${t('th_domain')}</th><th>${t('th_intent')}</th><th>${t('th_success')}</th><th class="num">${t('th_fail')}</th><th>${t('th_status')}</th></tr></thead><tbody>${patterns || `<tr><td colspan="5" class="muted">${t('p_hint')}</td></tr>`}</tbody></table>`;
  },
  nba() {
    const b = ui.snap?.bandit || [];
    if (!b.length) return emptyBox('zap', t('n_empty'));
    return `<p class="hint">${t('n_hint')}</p>
      <table class="table"><thead><tr><th>${t('th_action')}</th><th>${t('th_intent')}</th><th class="num">${t('th_alpha')}</th><th class="num">${t('th_beta')}</th><th>${t('th_mean')}</th></tr></thead><tbody>
      ${b.map((x) => `<tr><td>${esc(x.label || x.key)}</td><td><code>${esc(x.key.split('|')[1])}</code></td><td class="num">${x.alpha}</td><td class="num">${x.beta}</td><td>${meter(x.alpha / (x.alpha + x.beta))}<span class="num">${(x.alpha / (x.alpha + x.beta)).toFixed(2)}</span></td></tr>`).join('')}
      </tbody></table>`;
  },
  bus() {
    const log = ui.snap?.busLog || [];
    if (!log.length) return emptyBox('handoff', t('b_empty'));
    return `<table class="table"><tbody>${[...log]
      .reverse()
      .map((e) => `<tr><td style="white-space:nowrap"><span class="op op-handoff">${esc(e.topic)}</span></td><td>${renderValue(e.payload, 1)}</td><td class="time-cell">${new Date(e.at).toLocaleTimeString()}</td></tr>`)
      .join('')}</tbody></table>`;
  },
};

function renderTab() {
  if (!ui.snap) return;
  $('#tabBody').innerHTML = TABS[ui.tab]();
  $$('#tabBody [data-resolve]').forEach((b) => (b.onclick = () => api('/api/facts/resolve', { factId: b.dataset.resolve }).then(refresh)));
  $$('#tabBody [data-pin]').forEach((b) => (b.onclick = () => api('/api/facts/pin', { factId: b.dataset.pin, pinned: b.dataset.pinned === 'true' }).then(refresh)));
  $$('#tabBody [data-rollback]').forEach((b) => (b.onclick = () => api('/api/skills/rollback', { skillId: b.dataset.rollback }).then(refresh)));
  $$('#tabBody [data-history]').forEach((b) => (b.onclick = () => showHistory(b.dataset.history)));
  const at = $('#asOfInput');
  if (at) {
    at.onchange = () => {
      const ms = at.value ? new Date(at.value).getTime() : NaN;
      ui.asOf = Number.isFinite(ms) ? ms : null;
      refresh();
    };
    const now = $('#asOfNow');
    if (now) now.onclick = () => ((ui.asOf = null), refresh());
  }
  if (ui.tab === 'graph') loadGraph();
}

// ---- v0.5: memory over time ----
const STATE_BADGE = { active: 'success', conflicted: 'warning', expired: 'warning', superseded: '', resolved: '' };
function stateBadge(state = 'active') {
  return `<span class="badge ${STATE_BADGE[state] ?? ''}">${state === 'conflicted' ? icon('alert', 12) : ''}${esc(t('st_' + state))}</span>`;
}

// <input type="datetime-local"> wants local time without seconds.
const localInput = (ms) => {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function timeBar() {
  const s = ui.snap;
  const at = s.asOf ?? s.now;
  return `<div class="time-bar ${s.asOf ? 'past' : ''}">
    <label class="field-inline">${icon('clock', 14)}<span>${t('asof_label')}</span><input type="datetime-local" id="asOfInput" value="${localInput(at)}" /></label>
    ${s.asOf ? `<button class="btn sm" id="asOfNow">${t('asof_now')}</button><span class="small">${esc(t('asof_banner', { at: new Date(s.asOf).toLocaleString() }))}</span>` : `<span class="muted small">${esc(t('asof_hint', { n: s.historyDays }))}</span>`}
  </div>`;
}

// ---- v0.6: entity graph ----
// The customer in the centre, the entities its facts are about on an inner
// ring, the facts around their entity. Dashed curves are affinity edges (a
// related kind of fact); the spokes are "same entity". RAS spreads relevance
// along exactly these edges, and only between facts the asking agent may see.
async function loadGraph() {
  const box = $('#graphBox');
  if (!box) return;
  try {
    ui.graph = await api(`/api/graph?customerId=${encodeURIComponent(ui.customerId)}&lang=${lang()}${ui.asOf ? `&asOf=${ui.asOf}` : ''}`);
    if (!ui.graph.facts.some((f) => f.id === ui.graphSel)) ui.graphSel = null;
    drawGraph();
  } catch (err) {
    box.innerHTML = `<div class="muted small">${esc(err.message)}</div>`;
  }
}

const ENDED = new Set(['expired', 'superseded', 'resolved']);
const clip = (s, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function entityLabel(e) {
  if (e.kind === 'trip') return e.label || e.key;
  if (e.kind === 'asset') return e.label || t('g_asset_' + e.key);
  return t('g_ent_' + e.key);
}

function drawGraph() {
  const box = $('#graphBox');
  const g = ui.graph;
  if (!box || !g) return;
  if (!g.facts.length) return void (box.innerHTML = emptyBox('workflow', t('g_empty')));
  const W = 760, H = 480, cx = W / 2, cy = H / 2;
  const pos = new Map();
  const ents = [...g.entities].sort((a, b) => (a.kind === 'profile') - (b.kind === 'profile') || a.id.localeCompare(b.id));
  const step = (2 * Math.PI) / ents.length;
  ents.forEach((e, i) => {
    const a = -Math.PI / 2 + i * step;
    pos.set(e.id, { x: cx + 150 * Math.cos(a), y: cy + 105 * Math.sin(a), a });
    const fs = g.facts.filter((f) => f.entity === e.id);
    const spread = Math.min(step * 0.8, (fs.length - 1) * 0.2);
    fs.forEach((f, j) => {
      const b = a - spread / 2 + (fs.length > 1 ? (j * spread) / (fs.length - 1) : 0);
      pos.set(f.id, { x: cx + 290 * Math.cos(b), y: cy + 195 * Math.sin(b), a: b });
    });
  });
  const sel = ui.graphSel;
  const near = new Set(sel ? [sel] : []);
  if (sel) for (const e of g.edges) if (e.from === sel || e.to === sel) near.add(e.from === sel ? e.to : e.from);
  const dim = (id) => (sel && !near.has(id) ? ' dim' : '');
  const line = (a, b, cls) => `<line class="${cls}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
  const centre = { x: cx, y: cy };
  const spokes = ents.map((e) => line(centre, pos.get(e.id), 'g-spoke' + (sel ? ' dim' : ''))).join('');
  const members = g.facts.map((f) => line(pos.get(f.entity), pos.get(f.id), `g-member${ENDED.has(f.state) ? ' ended' : ''}${dim(f.id)}`)).join('');
  const affinity = g.edges
    .filter((e) => e.kind === 'affinity')
    .map((e) => {
      const a = pos.get(e.from), b = pos.get(e.to);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const c = { x: mx + (cx - mx) * 0.55, y: my + (cy - my) * 0.55 };
      const on = sel && (e.from === sel || e.to === sel);
      return `<path class="g-affinity${on ? ' on' : sel ? ' dim' : ''}" d="M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}"/>`;
    })
    .join('');
  const entNodes = ents
    .map((e) => {
      const p = pos.get(e.id);
      return `<g class="g-entity ${e.kind}${sel ? ' dim' : ''}"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${e.kind === 'profile' ? 15 : 18}"/><text x="${p.x.toFixed(1)}" y="${(p.y + 32).toFixed(1)}" text-anchor="middle">${esc(clip(entityLabel(e), 20))}</text></g>`;
    })
    .join('');
  const factNodes = g.facts
    .map((f) => {
      const p = pos.get(f.id);
      const right = Math.cos(p.a) >= 0;
      const cls = `g-fact ${ENDED.has(f.state) ? 'ended' : f.state}${f.scope === 'private' ? ' private' : ''}${f.id === sel ? ' sel' : ''}${dim(f.id)}`;
      return `<g class="${cls}" data-fact="${f.id}" tabindex="0" role="button"><title>${esc(f.text)}</title><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7"/><text x="${(p.x + (right ? 11 : -11)).toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(clip(f.value))}</text></g>`;
    })
    .join('');
  const hub = `<g class="g-customer"><circle cx="${cx}" cy="${cy}" r="20"/><text x="${cx}" y="${cy + 36}" text-anchor="middle">${esc(clip(g.customer.name, 20))}</text></g>`;
  const counts = t('g_counts', { e: g.entities.length, f: g.facts.length, a: g.edges.filter((e) => e.kind === 'affinity').length });
  box.innerHTML = `<div class="graph-legend small"><span>${esc(counts)}</span>
      <span><i class="lg-dot"></i>${t('g_lg_fact')}</span><span><i class="lg-dot private"></i>${t('g_lg_private')}</span><span><i class="lg-dot ended"></i>${t('g_lg_ended')}</span><span><i class="lg-dash"></i>${t('g_lg_affinity')}</span><span><i class="lg-ring"></i>${t('g_lg_profile')}</span></div>
    <svg class="graph-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('tab_graph'))}">${spokes}${members}${affinity}${entNodes}${hub}${factNodes}</svg>
    <div id="graphInfo">${graphInfo()}</div>`;
  $$('#graphBox [data-fact]').forEach((n) => {
    const pick = (ev) => {
      ev.stopPropagation();
      ui.graphSel = ui.graphSel === n.dataset.fact ? null : n.dataset.fact;
      drawGraph();
    };
    n.onclick = pick;
    n.onkeydown = (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), pick(ev));
  });
  $('#graphBox svg').onclick = () => ui.graphSel && ((ui.graphSel = null), drawGraph());
}

function graphInfo() {
  const g = ui.graph;
  const f = g.facts.find((x) => x.id === ui.graphSel);
  if (!f) return `<p class="hint">${t('g_hint')}</p>`;
  const byId = new Map(g.facts.map((x) => [x.id, x]));
  const ent = g.entities.find((e) => e.id === f.entity);
  const links = g.edges
    .filter((e) => e.from === f.id || e.to === f.id)
    .map((e) => {
      const o = byId.get(e.from === f.id ? e.to : e.from);
      const why = e.kind === 'entity' ? t('g_same', { name: entityLabel(ent) }) : t('g_related', { a: f.relation, b: o.relation });
      // A private fact is only reachable from its own domain's agents.
      const p = [f, o].find((x) => x.scope === 'private');
      const lock = p ? ` <span class="badge scope private">${icon('lock', 11)}${esc(t('g_only', { domain: p.ownerDomain }))}</span>` : '';
      return `<li>${esc(o.text)} <span class="muted small">· ${esc(why)} · ${e.weight}</span>${lock}</li>`;
    })
    .join('');
  return `<div class="info-card"><h4 class="graph-title">${esc(f.text)}</h4>
    <div class="small" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">${stateBadge(f.state)}${scopeTag(f.scope)}<span class="muted">${esc(f.ownerDomain)} · ${esc(entityLabel(ent))}</span></div>
    ${links ? `<div class="section-label">${t('g_links')}</div><ul class="graph-links">${links}</ul>` : `<div class="muted small">${t(ENDED.has(f.state) ? 'g_ended' : 'g_alone')}</div>`}</div>`;
}

async function showHistory(id) {
  const row = $(`#hist-${id}`);
  if (!row) return;
  if (!row.hidden) return void (row.hidden = true);
  const { history } = await api(`/api/facts/${encodeURIComponent(id)}/history?lang=${lang()}`);
  const when = (ms) => (ms ? new Date(ms).toLocaleString() : '');
  row.firstElementChild.innerHTML = `<div class="history-chain"><span class="section-label">${t('hist_title')}</span>${history
    .map((f) => `<span class="hist-item ${f.invalidatedAt ? 'old' : ''}"><b>${esc(f.text)}</b><small>${esc(when(f.recordedAt))}${f.invalidatedAt ? ` → ${esc(when(f.invalidatedAt))} · ${esc(t('hist_' + (f.invalidReason || 'superseded')))}` : ` · ${esc(t('hist_current'))}`}</small></span>`)
    .join(`<span class="muted">→</span>`)}</div>`;
  row.hidden = false;
}

// ======================= Wiring =======================
$('#langMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lang]');
  if (b) b.dataset.lang === lang() ? closeMenus() : setLang(b.dataset.lang);
});
$$('#themeSwitch button').forEach((b) => (b.onclick = () => applyTheme(b.dataset.themeOpt)));

$('#agentMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-agent]');
  if (!b) return;
  ui.agentId = b.dataset.agent;
  closeMenus();
  renderChatHead();
  $('#input').focus();
});
$('#promptMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  closeMenus();
  const [, agentId, text] = SCENARIOS[lang()][Number(b.dataset.i)];
  send(text, agentId);
});

$('#customerSelect').addEventListener('change', (e) => {
  ui.customerId = e.target.value;
  store('brain.customer', ui.customerId);
  ui.last = null;
  ui.lastChatAgent = null;
  ui.chatStarted = false;
  renderChatEmpty();
  refresh();
});
$('#addCustomer').addEventListener('click', async () => {
  const name = window.prompt(t('new_customer_prompt'));
  if (!name) return;
  try {
    const c = await api('/api/customers', { name });
    ui.customerId = c.id;
    store('brain.customer', c.id);
    ui.chatStarted = false;
    ui.last = null;
    renderChatEmpty();
    await refresh();
  } catch (err) {
    toast(esc(err.message), 'info', icon('alert'));
  }
});

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  ui.tab = b.dataset.tab;
  $$('#tabs button').forEach((x) => {
    x.classList.toggle('active', x === b);
    x.setAttribute('aria-selected', String(x === b));
  });
  renderTab();
});

const input = $('#input');
const autosize = () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(140, input.scrollHeight)}px`;
};
input.addEventListener('input', autosize);
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = input.value;
  input.value = '';
  autosize();
  send(v);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});

$('#sleepBtn').addEventListener('click', async () => {
  $('#sleepBtn').disabled = true;
  try {
    const r = await api('/api/sleep', { customerId: ui.customerId, lang: lang() });
    ensurePlayed(r);
    toast(esc(t('slept', { c: r.consolidated, f: r.forgotten.expiredFacts.length, i: r.insights.length })), 'info', icon('moon'));
  } finally {
    $('#sleepBtn').disabled = false;
  }
});

$('#timeMenu').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-days]');
  if (!b) return;
  closeMenus();
  await api('/api/clock', { days: Number(b.dataset.days) });
  toast(esc(t('time_passed', { n: b.dataset.days })), 'info', icon('forward'));
  refresh();
});

$('#vipToggle').addEventListener('change', (e) => api('/api/customers/vip', { customerId: ui.customerId, vip: e.target.checked }).then(refresh));

$('#resetBtn').addEventListener('click', async () => {
  closeMenus();
  if (!confirm(t('confirm_reset'))) return;
  await api('/api/reset', {});
  ui.last = null;
  ui.trace = null;
  ui.lastChatAgent = null;
  ui.chatStarted = false;
  brain.reset();
  renderTraceEmpty();
  renderChatEmpty();
  renderCanvasHead();
  refresh();
});

window.addEventListener('hashchange', route);

hydrateIcons();
applyTheme(store('brain.theme') || 'system');
setCurrentLang(loadLang());
applyStaticI18n();
brain.setLang(lang());
connect();
route();
refresh().then(() => applyStaticI18n());
