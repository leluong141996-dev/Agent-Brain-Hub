// View: Settings — choose the LLM provider (Claude, GPT, Gemini, DeepSeek,
// Mistral, Groq, Grok, OpenRouter, local servers…), test it and apply it live.
// Also: when the brain sleeps on its own, and where the memory is stored.
import { $, $$, esc, api, pageHead, toast, fmtNum, LOCALES } from '../util.js';
import { icon } from '../icons.js';
import { t, lang } from '../i18n.js';

const BRAND = {
  anthropic: '#d97757', openai: '#10a37f', gemini: '#4285f4', deepseek: '#4d6bfe', mistral: '#fa520f', groq: '#f55036', xai: '#64748b',
  openrouter: '#6467f2', together: '#0f6fff', ollama: '#64748b', vllm: '#e09f12', lmstudio: '#7c3aed', custom: '#0ea5e9', offline: '#94a3b8',
};
const GROUPS = [
  ['prov_cloud', ['anthropic', 'openai', 'gemini', 'deepseek', 'mistral', 'groq', 'xai', 'openrouter', 'together']],
  ['prov_local', ['ollama', 'vllm', 'lmstudio']],
  ['prov_other', ['custom', 'offline']],
];

let form = null; // unsaved form state
let models = [];

export async function render(root, ctx) {
  const [{ config, providers }, storage, sleep, emb] = await Promise.all([api('/api/settings/llm'), api('/api/storage'), api('/api/settings/sleep'), api('/api/settings/embeddings')]);
  const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
  if (!form || form.saved !== config.provider + config.model) {
    form = { ...config, apiKey: '', saved: config.provider + config.model };
    models = [];
  }
  const snapErr = ctx.ui.snap?.llm?.lastError;
  const status = !config.available ? ['', t('llm_status_off')] : snapErr ? ['warning', t('llm_status_err')] : ['success', t('llm_status_on')];

  root.innerHTML = `
    ${pageHead(icon('menu', 18), t('nav_settings'), t('st_sub'))}
    <div class="page-body">
      ${config.forcedOffline ? `<div class="callout warning">${icon('alert', 15)}<span>${t('forced_offline')}</span></div>` : ''}
      <div class="card">
        <div class="card-head">
          <div class="ico-tile">${icon('cpu', 18)}</div>
          <div style="flex:1;min-width:0"><div class="card-title">${t('llm_title')}</div><div class="card-sub">${t('llm_sub')}</div></div>
          <div class="active-llm"><span class="badge ${status[0]}">${status[1]}</span><span class="muted small">${t('active')}:</span> <b>${esc(config.label)}</b></div>
        </div>
        <div class="card-body settings-body">
          <div class="section-label">${t('prov_section')}</div>
          ${GROUPS.map(([label, ids]) => `
            <div class="prov-group">
              <div class="prov-group-label">${icon(label === 'prov_local' ? 'server' : label === 'prov_cloud' ? 'cloud' : 'sliders', 13)}${t(label)}</div>
              <div class="prov-grid">${ids.filter((id) => byId[id]).map((id) => tile(byId[id], config)).join('')}</div>
            </div>`).join('')}

          <div class="section-label" style="margin-top:8px">${t('conn_section')}</div>
          <div id="connForm"></div>
        </div>
        <div class="dialog-foot settings-foot">
          <div class="test-result" id="testResult"></div>
          <button class="btn" id="btnTest">${icon('activity')}<span>${t('btn_test')}</span></button>
          <button class="btn primary" id="btnSave">${icon('check')}<span>${t('btn_save')}</span></button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="ico-tile neutral">${icon('layers', 18)}</div><div class="card-title">${t('usage_title')}</div></div>
        <table class="table">
          <tbody>
            ${usageRow('message', t('usage_reply'), t('usage_main'), config.model)}
            ${usageRow('database', t('usage_extract'), config.utilityModel ? t('usage_utility') : t('usage_main'), config.utilityModel || config.model)}
            ${usageRow('moon', t('usage_summary'), config.utilityModel ? t('usage_utility') : t('usage_main'), config.utilityModel || config.model)}
            ${usageRow('bulb', t('usage_reflect'), config.utilityModel ? t('usage_utility') : t('usage_main'), config.utilityModel || config.model)}
          </tbody>
        </table>
        <div class="card-body"><div class="callout">${icon('shield', 15)}<span>${t('fallback_note')}</span></div></div>
      </div>

      <div class="card" id="embCard"></div>

      <div class="card" id="sleepCard"></div>

      ${storageCard(storage)}
    </div>`;

  drawEmbeddings($('#embCard', root), emb);
  drawSleep($('#sleepCard', root), sleep);
  drawForm(root, byId, config);
  $$('.prov-tile', root).forEach((b) => {
    b.onclick = () => {
      const p = byId[b.dataset.id];
      if (form.provider !== p.id) {
        form = { ...form, provider: p.id, baseUrl: p.baseUrl, model: p.id === config.provider ? config.model : p.model, utilityModel: p.id === config.provider ? config.utilityModel : p.utility || '', apiKey: '' };
        models = [];
      }
      $$('.prov-tile', root).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      drawForm(root, byId, config);
      $('#testResult', root).innerHTML = '';
    };
  });
  $('#btnTest', root).onclick = () => runTest(root);
  $('#btnSave', root).onclick = async () => {
    readForm(root);
    const body = payload();
    const r = await api('/api/settings/llm', body, 'PUT');
    form = null;
    toast(esc(t('saved_toast', { label: r.config.label })), 'success', icon('checkCircle'));
    await ctx.refresh();
    render(root, ctx);
  };
}

function tile(p, config) {
  const checked = (form?.provider || config.provider) === p.id;
  const desc = p.id === 'offline' ? t('offline_desc') : p.id === 'custom' ? t('custom_desc') : p.vendor;
  return `<button type="button" class="prov-tile" role="radio" data-id="${p.id}" aria-checked="${checked}" style="--c:${BRAND[p.id] || '#6366f1'}">
    <span class="prov-mark">${esc(p.label.slice(0, 2))}</span>
    <span class="prov-text"><b>${esc(p.label)}${config.provider === p.id ? `<span class="dot st-hit" title="${esc(t('active'))}"></span>` : ''}</b><span>${esc(desc)}</span></span>
    ${p.envKeySet ? `<span class="badge mono" title="${esc(p.keyEnv)}">ENV</span>` : ''}
  </button>`;
}

function usageRow(ic, task, which, model) {
  return `<tr><td style="width:40px"><span class="muted">${icon(ic)}</span></td><td>${esc(task)}</td><td><span class="badge">${esc(which)}</span></td><td><code>${esc(model || '—')}</code></td></tr>`;
}

function drawForm(root, byId, config) {
  const p = byId[form.provider];
  const box = $('#connForm', root);
  if (p.kind === 'offline') {
    box.innerHTML = `<div class="callout">${icon('info', 15)}<span>${t('offline_desc')}. ${t('fallback_note')}</span></div>`;
    return;
  }
  const sameAsSaved = form.provider === config.provider;
  const keyHelp = sameAsSaved && config.hasKey ? t('key_saved', { hint: config.keyHint }) : p.envKeySet ? t('key_env', { env: p.keyEnv }) : p.needsKey ? t('key_none') : t('key_not_needed');
  box.innerHTML = `
    <div class="grid2">
      ${p.kind === 'openai-compat' ? `<label class="field"><span>${t('f_base_url')}</span><input id="fBase" value="${esc(form.baseUrl || '')}" placeholder="https://…/v1" spellcheck="false" /><small>${t('f_base_hint')}</small></label>` : ''}
      <label class="field"><span>${t('f_api_key')}</span>
        <span class="input-group"><input id="fKey" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(sameAsSaved && config.hasKey ? config.keyHint : p.keyEnv || 'sk-…')}" value="${esc(form.apiKey || '')}" />
        <button type="button" class="icon-btn sm" id="toggleKey" title="${esc(t('show'))}" aria-label="${esc(t('show'))}">${icon('eye', 14)}</button></span>
        <small>${esc(keyHelp)}</small></label>
    </div>
    <div class="grid2">
      <label class="field"><span>${t('f_model')}</span>
        <span class="input-group"><input id="fModel" list="modelList" value="${esc(form.model || '')}" placeholder="${esc(p.model || 'model-id')}" spellcheck="false" />
        <button type="button" class="btn sm" id="btnModels">${icon('download', 13)}<span>${t('fetch_models')}</span></button></span>
        <small id="modelsInfo">${models.length ? t('models_found', { n: models.length }) : t('f_model_hint')}</small></label>
      <label class="field"><span>${t('f_utility')}</span><input id="fUtility" list="modelList" value="${esc(form.utilityModel || '')}" placeholder="${esc(p.utility || '')}" spellcheck="false" /><small>${t('f_utility_hint')}</small></label>
    </div>
    <datalist id="modelList">${models.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
    <div class="grid2">
      <label class="field"><span>${t('f_temperature')}</span><input id="fTemp" type="number" min="0" max="2" step="0.1" value="${esc(form.temperature ?? 0.4)}" /></label>
      <label class="field"><span>${t('f_max_tokens')}</span><input id="fMax" type="number" min="64" max="32000" step="64" value="${esc(form.maxTokens ?? 2000)}" /></label>
    </div>`;
  $('#toggleKey', root).onclick = () => {
    const k = $('#fKey', root);
    k.type = k.type === 'password' ? 'text' : 'password';
  };
  $('#btnModels', root).onclick = async () => {
    readForm(root);
    const info = $('#modelsInfo', root);
    info.textContent = t('testing');
    const r = await api('/api/settings/llm/models', payload());
    models = r.models || [];
    $('#modelList', root).innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join('');
    info.innerHTML = r.error ? `<span style="color:var(--danger)">${esc(t('models_err', { err: r.error }))}</span>` : esc(t('models_found', { n: models.length }));
    if (models.length && !models.includes($('#fModel', root).value)) $('#fModel', root).focus();
  };
}

function readForm(root) {
  const v = (id) => $(id, root)?.value;
  if ($('#fModel', root)) {
    form.baseUrl = v('#fBase') ?? form.baseUrl;
    form.apiKey = v('#fKey') || '';
    form.model = v('#fModel');
    form.utilityModel = v('#fUtility');
    form.temperature = v('#fTemp');
    form.maxTokens = v('#fMax');
  }
}

function payload() {
  return { provider: form.provider, baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model, utilityModel: form.utilityModel, temperature: form.temperature, maxTokens: form.maxTokens };
}

async function runTest(root) {
  readForm(root);
  const out = $('#testResult', root);
  out.innerHTML = `<span class="muted">${t('testing')}</span>`;
  const r = await api('/api/settings/llm/test', payload());
  if (r.ok) {
    const adjusted = [];
    if (r.quirks?.maxTokensParam === 'max_completion_tokens') adjusted.push('max_completion_tokens');
    if (r.quirks && !r.quirks.temperature) adjusted.push('no temperature');
    if (r.quirks && !r.quirks.jsonMode) adjusted.push('no JSON mode');
    out.innerHTML = `<span class="ok">${icon('checkCircle', 15)}${esc(t('test_ok', { ms: r.ms, model: r.model }))}</span>${adjusted.length ? `<span class="muted small">${esc(t('adapted', { list: adjusted.join(', ') }))}</span>` : ''}`;
  } else {
    out.innerHTML = `<span class="fail">${icon('xCircle', 15)}${esc(t('test_fail'))}</span><span class="muted small err">${esc(r.error || '')}</span>`;
  }
}

// ---------------- Semantic search (embeddings) ----------------
let embForm = null; // unsaved form state

function drawEmbeddings(box, data) {
  const { config: c, providers, status } = data;
  if (!embForm || embForm.saved !== c.provider + c.model) embForm = { provider: c.provider, baseUrl: c.baseUrl, model: c.model, apiKey: '', saved: c.provider + c.model };
  const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
  const p = byId[embForm.provider];
  const on = c.available;
  const pctDone = status.total ? Math.round((status.done / status.total) * 100) : 0;
  const statusLine = !on
    ? `<span class="muted small">${t('emb_status_off')}</span>`
    : `<div class="emb-status"><span class="small"><b>${esc(c.modelId)}</b> · ${esc(t('emb_indexed', { done: fmtNum(status.done, lang()), total: fmtNum(status.total, lang()) }))}</span>
        <div class="bar" role="progressbar" aria-valuenow="${pctDone}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pctDone}%"></i></div>
        ${status.lastError ? `<span class="small" style="color:var(--danger)">${esc(t('emb_error', { err: status.lastError }))}</span>` : ''}</div>`;
  box.innerHTML = `
    <div class="card-head">
      <div class="ico-tile">${icon('search', 18)}</div>
      <div style="flex:1;min-width:0"><div class="card-title">${t('emb_title')}</div><div class="card-sub">${t('emb_sub')}</div></div>
      <span class="badge ${on ? 'success' : ''}">${on ? esc(c.label) : t('emb_off')}</span>
    </div>
    <div class="card-body settings-body">
      <div class="grid2">
        <label class="field"><span>${t('emb_provider')}</span>
          <select id="eProvider">
            <option value="off" ${embForm.provider === 'off' ? 'selected' : ''}>${t('emb_off')}</option>
            ${providers.map((x) => `<option value="${x.id}" ${embForm.provider === x.id ? 'selected' : ''}>${esc(x.label)}${x.local ? ` · ${t('prov_local')}` : ''}</option>`).join('')}
          </select></label>
        ${p ? `<label class="field"><span>${t('emb_model')}</span><input id="eModel" value="${esc(embForm.model || '')}" placeholder="${esc(p.model || 'model-id')}" spellcheck="false" /><small>${t('emb_model_hint')}</small></label>` : '<div></div>'}
      </div>
      ${p ? `<div class="grid2">
        <label class="field"><span>${t('f_base_url')}</span><input id="eBase" value="${esc(embForm.baseUrl || '')}" placeholder="${esc(p.baseUrl || 'https://…/v1')}" spellcheck="false" /></label>
        <label class="field"><span>${t('f_api_key')}</span><input id="eKey" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(embForm.provider === c.provider && c.hasKey ? c.keyHint : p.needsKey ? 'sk-…' : t('key_not_needed'))}" value="${esc(embForm.apiKey || '')}" /></label>
      </div>
      <div class="callout warning">${icon('shield', 15)}<span>${t('emb_privacy')}</span></div>` : `<div class="callout">${icon('info', 15)}<span>${t('emb_off_desc')}</span></div>`}
      ${statusLine}
    </div>
    <div class="dialog-foot settings-foot">
      <div class="test-result" id="eResult"></div>
      ${p ? `<button class="btn" id="eTest">${icon('activity')}<span>${t('btn_test')}</span></button>` : ''}
      <button class="btn primary" id="eSave">${icon('check')}<span>${t('btn_save')}</span></button>
    </div>`;
  const read = () => {
    embForm.provider = $('#eProvider', box).value;
    if ($('#eModel', box)) {
      embForm.model = $('#eModel', box).value.trim();
      embForm.baseUrl = $('#eBase', box).value.trim();
      embForm.apiKey = $('#eKey', box).value;
    }
  };
  const payload = () => (embForm.provider === 'off' ? { provider: 'off' } : { provider: embForm.provider, model: embForm.model, baseUrl: embForm.baseUrl, apiKey: embForm.apiKey });
  $('#eProvider', box).onchange = () => {
    const id = $('#eProvider', box).value;
    const x = byId[id];
    embForm = { ...embForm, provider: id, model: id === c.provider ? c.model : x?.model || '', baseUrl: id === c.provider ? c.baseUrl : x?.baseUrl || '', apiKey: '' };
    drawEmbeddings(box, data);
  };
  const out = $('#eResult', box);
  if ($('#eTest', box))
    $('#eTest', box).onclick = async () => {
      read();
      out.innerHTML = `<span class="muted small">${t('testing')}</span>`;
      const r = await api('/api/settings/embeddings/test', payload());
      out.innerHTML = r.ok
        ? `<span class="ok">${icon('checkCircle', 15)}${esc(t('emb_test_ok', { dims: r.dims, ms: r.ms, sim: r.similarity, hash: r.hashing }))}</span>`
        : `<span class="fail">${icon('xCircle', 15)}${esc(t('test_fail'))}</span><span class="muted small err">${esc(r.error || '')}</span>`;
    };
  $('#eSave', box).onclick = async () => {
    read();
    try {
      const r = await api('/api/settings/embeddings', payload(), 'PUT');
      embForm = null;
      toast(esc(t('emb_saved', { label: r.config.available ? r.config.modelId : t('emb_off') })), 'success', icon('search'));
      drawEmbeddings(box, { ...data, config: r.config, status: r.status });
    } catch (e) {
      out.innerHTML = `<span class="fail">${icon('xCircle', 15)}${esc(e.message)}</span>`;
    }
  };
  // While memories are being indexed, refresh the progress every 2 s.
  if (on && status.done < status.total) {
    setTimeout(async () => {
      if (!box.isConnected) return;
      const next = await api('/api/settings/embeddings');
      if (box.isConnected) drawEmbeddings(box, next);
    }, 2000);
  }
}

// ---------------- Sleep cycle ----------------
const TRIGGER_BADGE = { manual: '', idle: 'info', pressure: 'warning', nightly: 'violet' };
const when = (ts) => new Date(ts).toLocaleString(LOCALES[lang()], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const trig = (k) => `<span class="badge ${TRIGGER_BADGE[k] ?? ''}">${esc(t('trig_' + k))}</span>`;

function drawSleep(box, st) {
  const c = st.config;
  const on = c.enabled;
  const pending = st.pending.length
    ? `<table class="table"><thead><tr><th>${t('sl_customer')}</th><th>${t('sl_turns')}</th><th>${t('sl_idle_for')}</th><th>${t('sl_next')}</th></tr></thead><tbody>
        ${st.pending.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono">${p.turns}</td><td class="mono">${t('sl_minutes', { n: fmtNum(p.idleMinutes, lang()) })}</td>
          <td>${!on ? '—' : p.trigger ? trig(p.trigger) : esc(t('sl_after', { n: Math.max(0, c.idleMinutes - p.idleMinutes) }))}</td></tr>`).join('')}
      </tbody></table>`
    : `<p class="muted small">${t('sl_nothing_pending')}</p>`;
  const history = st.history.length
    ? `<table class="table"><thead><tr><th>${t('sl_when')}</th><th>${t('sl_trigger')}</th><th>${t('sl_customer')}</th><th>${t('sl_result')}</th></tr></thead><tbody>
        ${st.history.slice(0, 8).map((h) => `<tr><td class="mono small">${esc(when(h.at))}</td><td>${trig(h.trigger)}</td><td>${esc(h.name || h.customerId)}</td>
          <td class="small">${esc(t('sl_result_v', { c: h.consolidated, i: h.insights, f: h.forgotten }))} <span class="muted">· ${h.ms} ms</span></td></tr>`).join('')}
      </tbody></table>`
    : `<p class="muted small">${t('sl_no_history')}</p>`;
  box.innerHTML = `
    <div class="card-head">
      <div class="ico-tile">${icon('moon', 18)}</div>
      <div style="flex:1;min-width:0"><div class="card-title">${t('sl_title')}</div><div class="card-sub">${t('sl_sub')}</div></div>
      <span class="badge ${on ? 'success' : ''}">${on ? t('sl_on') : t('sl_off')}</span>
    </div>
    <div class="card-body settings-body">
      <label class="switch-row"><input type="checkbox" class="switch" id="slEnabled" ${on ? 'checked' : ''} /><span><b>${t('sl_enabled')}</b><small>${t('sl_enabled_hint')}</small></span></label>
      <div class="grid2">
        <label class="field"><span>${t('sl_idle')}</span><input id="slIdle" type="number" min="5" max="1440" step="5" value="${c.idleMinutes}" /><small>${t('sl_idle_hint')}</small></label>
        <label class="field"><span>${t('sl_pressure')}</span><input id="slPressure" type="number" min="6" max="38" step="1" value="${c.maxPendingTurns}" /><small>${t('sl_pressure_hint')}</small></label>
      </div>
      <div class="grid2">
        <label class="switch-row"><input type="checkbox" class="switch" id="slNightly" ${c.nightly ? 'checked' : ''} /><span><b>${t('sl_nightly')}</b><small>${t('sl_nightly_hint')}</small></span></label>
        <label class="field"><span>${t('sl_nightly_at')}</span><input id="slAt" type="time" value="${esc(c.nightlyAt)}" />
          <small>${esc(t('sl_tz', { tz: st.timeZone }))}${st.nextNightly ? ` · ${esc(t('sl_next_night', { at: when(st.nextNightly) }))}` : ''}</small></label>
      </div>
      <div class="grid2">
        <label class="field"><span>${t('sl_history_days')}</span><input id="slHistory" type="number" min="0" max="3650" step="1" value="${c.historyDays ?? 90}" /><small>${t('sl_history_hint')}</small></label>
      </div>
      <div class="section-label" style="margin-top:4px">${t('sl_pending')}</div>
      ${pending}
      <div class="section-label" style="margin-top:4px">${t('sl_history')}</div>
      ${history}
    </div>
    <div class="dialog-foot settings-foot">
      <div class="test-result" id="slMsg"></div>
      <button class="btn primary" id="slSave">${icon('check')}<span>${t('btn_save')}</span></button>
    </div>`;
  $('#slSave', box).onclick = async () => {
    const body = {
      enabled: $('#slEnabled', box).checked,
      nightly: $('#slNightly', box).checked,
      idleMinutes: $('#slIdle', box).value,
      maxPendingTurns: $('#slPressure', box).value,
      nightlyAt: $('#slAt', box).value,
      historyDays: $('#slHistory', box).value,
    };
    try {
      const next = await api('/api/settings/sleep', body, 'PUT');
      toast(esc(t('sl_saved')), 'success', icon('moon'));
      drawSleep(box, next);
    } catch (e) {
      $('#slMsg', box).innerHTML = `<span class="fail">${icon('xCircle', 15)}${esc(e.message)}</span>`;
    }
  };
}

function storageCard(st) {
  const mb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
  const body =
    st.backend === 'sqlite'
      ? `<div class="kv" style="font-size:13px">
          <div class="k">${t('storage_backend')}</div><div class="v">SQLite ${esc(st.sqliteVersion)} · <span class="badge mono">${esc(st.journal)}</span></div>
          <div class="k">${t('storage_path')}</div><div class="v"><code>${esc(st.path)}</code></div>
          <div class="k">${t('storage_size')}</div><div class="v">${mb(st.sizeBytes)}</div>
          <div class="k">${t('storage_rows')}</div><div class="v">${Object.entries(st.rows).map(([k, n]) => `<span class="chip"><b>${esc(k)}</b>${n}</span>`).join('')}</div>
        </div>`
      : `<div class="callout warning">${icon('alert', 15)}<span>${t('storage_memory')}</span></div>`;
  return `<div class="card">
    <div class="card-head"><div class="ico-tile neutral">${icon('database', 18)}</div><div><div class="card-title">${t('storage_title')}</div><div class="card-sub">${t('storage_sub')}</div></div></div>
    <div class="card-body">${body}</div>
  </div>`;
}
