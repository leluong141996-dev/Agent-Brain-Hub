// View: Settings — choose the LLM provider (Claude, GPT, Gemini, DeepSeek,
// Mistral, Groq, Grok, OpenRouter, local servers…), test it and apply it live.
import { $, $$, esc, api, pageHead, toast } from '../util.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

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
  const [{ config, providers }, storage] = await Promise.all([api('/api/settings/llm'), api('/api/storage')]);
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

      ${storageCard(storage)}
    </div>`;

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
