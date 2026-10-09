// View: Agents — manage native and connected agents, their permissions and
// API keys, and get copy-paste integration snippets.
import { $, $$, esc, api, copy, fmtNum, pageHead, toast } from '../util.js';
import { icon, avatar } from '../icons.js';
import { t, lang } from '../i18n.js';

const SAMPLE = {
  vi: 'Tôi muốn gia hạn bảo hành laptop',
  en: 'I want to extend my laptop warranty',
  ja: 'ノートパソコンの保証を延長したいです',
};

export function render(root, ctx) {
  const s = ctx.ui.snap;
  const L = lang();
  root.innerHTML = `
    ${pageHead(icon('menu', 18), t('nav_agents'), t('ag_sub'), `<button class="btn primary" id="agCreate">${icon('plus')}<span>${t('ag_create')}</span></button>`)}
    <div class="page-body">
      <div class="section-head"><h2>${t('ag_methods')}</h2></div>
      <div class="methods">
        ${method('bot', '', t('ag_way_native'), t('ag_way_native_d'))}
        ${method('code', 'info', t('ag_way_api'), t('ag_way_api_d'))}
        ${method('plug', 'violet', t('ag_way_mcp'), t('ag_way_mcp_d'))}
      </div>
      <div class="section-head"><h2>${t('ag_list')}</h2><span>${t('ag_count', { n: s.agents.length })}</span></div>
      <div class="card table-card">
        <table class="table">
          <thead><tr>
            <th>${t('th_agent')}</th><th>${t('th_type')}</th><th>${t('th_domain')}</th>
            <th>${t('th_read')}</th><th>${t('th_write')}</th><th>${t('th_activity')}</th><th>${t('th_key')}</th><th></th>
          </tr></thead>
          <tbody>${s.agents.map((a) => row(a, s, L)).join('')}</tbody>
        </table>
      </div>
    </div>`;

  $('#agCreate', root).onclick = () => openCreate(ctx);
  $$('tr[data-id]', root).forEach((tr) => {
    const id = tr.dataset.id;
    const agent = s.agents.find((a) => a.id === id);
    $$('input[data-perm]', tr).forEach((cb) => {
      cb.onchange = async () => {
        await api(`/api/agents/${id}`, { permissions: { [cb.dataset.perm]: cb.checked } }, 'PATCH');
        ctx.refresh();
      };
    });
    $('[data-act=chat]', tr)?.addEventListener('click', () => ctx.goChat(id));
    $('[data-act=integrate]', tr).onclick = () => openIntegration(agent, ctx);
    $('[data-act=rotate]', tr).onclick = async () => {
      if (!confirm(t('confirm_rotate', { name: agent.name }))) return;
      const r = await api(`/api/agents/${id}/rotate-key`, {});
      await ctx.refresh();
      openKey(r.agent, r.apiKey, ctx);
    };
    $('[data-act=delete]', tr)?.addEventListener('click', async () => {
      if (!confirm(t('confirm_delete', { name: agent.name }))) return;
      await api(`/api/agents/${id}`, undefined, 'DELETE');
      ctx.refresh();
    });
  });
}

function method(ic, tone, title, desc) {
  return `<div class="card method"><div class="ico-tile ${tone}">${icon(ic, 18)}</div><div><h3>${title}</h3><p>${desc}</p></div></div>`;
}

function row(a, s, L) {
  const d = s.domains[a.domain];
  const st = a.stats || {};
  const facts = s.facts.filter((f) => f.sourceAgentId === a.id).length;
  const ext = a.kind === 'external';
  return `<tr data-id="${a.id}">
    <td><div class="agent-cell">${avatar(a.name, d?.color, 34)}<div><b>${esc(a.name)}</b><span title="${esc(a.description || a.persona || '')}">${esc(a.description || a.persona || '')}</span></div></div></td>
    <td><span class="badge ${ext ? 'info' : 'accent'}">${icon(ext ? 'plug' : 'bot', 12)}${ext ? t('kind_external') : t('kind_native')}</span></td>
    <td><span class="domain-cell" style="--c:${d?.color}"><i></i>${esc(d?.label)}${d?.episodeScope === 'private' ? icon('lock', 13) : ''}</span></td>
    <td><input type="checkbox" class="switch" data-perm="readShared" ${a.permissions?.readShared !== false ? 'checked' : ''} aria-label="${esc(t('perm_read'))}" title="${esc(t('perm_read'))}" /></td>
    <td><input type="checkbox" class="switch" data-perm="write" ${a.permissions?.write !== false ? 'checked' : ''} aria-label="${esc(t('perm_write'))}" title="${esc(t('perm_write'))}" /></td>
    <td><div class="activity-cell"><span><b>${fmtNum(st.turns || 0, L)}</b>${t('st_turns')}</span><span><b>${fmtNum(facts, L)}</b>${t('st_facts')}</span><span><b>${fmtNum((st.recalls || 0) + (st.remembers || 0), L)}</b>${t('st_api')}</span><span title="${esc(t('rv_trust_hint', { up: a.trust?.up || 0, down: a.trust?.down || 0 }))}"><b>${(a.trust?.score ?? 0.5).toFixed(2)}</b>${t('rv_trust')}</span></div></td>
    <td><span class="key-hint">${esc(a.keyHint || '—')}</span></td>
    <td><div class="row-actions">
      ${ext ? '' : `<button class="icon-btn" data-act="chat" title="${esc(t('chat'))}" aria-label="${esc(t('chat'))}">${icon('message')}</button>`}
      <button class="btn sm" data-act="integrate">${icon('code', 13)}<span>${t('integrate')}</span></button>
      <button class="icon-btn" data-act="rotate" title="${esc(t('rotate'))}" aria-label="${esc(t('rotate'))}">${icon('key')}</button>
      ${a.builtin ? '' : `<button class="icon-btn danger" data-act="delete" title="${esc(t('delete'))}" aria-label="${esc(t('delete'))}">${icon('trash')}</button>`}
    </div></td>
  </tr>`;
}

// ---------------- Dialogs ----------------
function dialog(html) {
  const dlg = $('#dialog');
  dlg.innerHTML = html;
  if (!dlg.open) dlg.showModal();
  $$('[data-close]', dlg).forEach((b) => (b.onclick = () => dlg.close()));
  return dlg;
}

const closeBtn = () => `<button type="button" class="icon-btn" data-close aria-label="${esc(t('close'))}">${icon('x', 18)}</button>`;

function openCreate(ctx) {
  const s = ctx.ui.snap;
  const dlg = dialog(`
    <form id="createForm">
      <div class="dialog-head"><div><h2>${t('ag_create')}</h2><p>${t('ag_sub')}</p></div>${closeBtn()}</div>
      <div class="dialog-body">
        <div class="field"><span>${t('f_kind')}</span>
          <div class="choices">
            <label class="choice"><input type="radio" name="kind" value="native" checked /><div class="ico-tile">${icon('bot', 18)}</div><div><b>${t('kind_native')}</b><span>${t('f_native_hint')}</span></div></label>
            <label class="choice"><input type="radio" name="kind" value="external" /><div class="ico-tile info">${icon('plug', 18)}</div><div><b>${t('kind_external')}</b><span>${t('f_external_hint')}</span></div></label>
          </div>
        </div>
        <div class="grid2">
          <label class="field"><span>${t('f_name')}</span><input name="name" required maxlength="40" placeholder="${esc(t('f_name_ph'))}" autofocus /></label>
          <label class="field"><span>${t('f_domain')}</span><select name="domain">${Object.entries(s.domains).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${t('f_desc')}</span><textarea name="persona" rows="2" placeholder="${esc(t('f_desc_ph'))}"></textarea></label>
        <div class="grid2">
          <label class="field"><span>${t('f_retention')}</span><input name="retentionDays" type="number" min="1" /><small>${t('f_retention_hint')}</small></label>
          <div class="field"><span>${t('f_perms')}</span>
            <div class="perm-list">
              <label>${t('perm_read')}<input type="checkbox" class="switch" name="readShared" checked /></label>
              <label>${t('perm_write')}<input type="checkbox" class="switch" name="write" checked /></label>
            </div>
          </div>
        </div>
      </div>
      <div class="dialog-foot"><button type="button" class="btn" data-close>${t('cancel')}</button><button type="submit" class="btn primary">${icon('plus')}<span>${t('create')}</span></button></div>
    </form>`);
  $('#createForm', dlg).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {
      name: f.get('name'),
      domain: f.get('domain'),
      kind: f.get('kind'),
      persona: f.get('persona'),
      description: f.get('persona'),
      retentionDays: f.get('retentionDays'),
      permissions: { readShared: f.get('readShared') === 'on', write: f.get('write') === 'on' },
    };
    try {
      const r = await api('/api/agents', body);
      await ctx.refresh();
      openKey(r.agent, r.apiKey, ctx);
    } catch (err) {
      toast(esc(err.message), 'info', icon('alert'));
    }
  };
}

function openKey(agent, apiKey, ctx) {
  const dlg = dialog(`
    <div class="dialog-head"><div class="ico-tile warning">${icon('key', 18)}</div><div><h2>${esc(t('key_title', { name: agent.name }))}</h2><p>${t('key_once')}</p></div>${closeBtn()}</div>
    <div class="dialog-body">
      <div class="keybox"><code>${esc(apiKey)}</code><button class="btn sm" id="copyKey" data-copied="${esc(t('copied'))}">${icon('copy', 13)}<span>${t('copy')}</span></button></div>
      ${integrationBody()}
    </div>
    <div class="dialog-foot"><button class="btn primary" data-close>${t('close')}</button></div>`);
  $('#copyKey', dlg).onclick = (e) => copy(apiKey, e.currentTarget);
  wireIntegration(dlg, agent, apiKey, ctx);
}

function openIntegration(agent, ctx) {
  const dlg = dialog(`
    <div class="dialog-head"><div class="ico-tile info">${icon('code', 18)}</div><div><h2>${esc(t('int_title', { name: agent.name }))}</h2><p>${t('int_key_hint')}</p></div>${closeBtn()}</div>
    <div class="dialog-body">${integrationBody()}</div>
    <div class="dialog-foot"><button class="btn primary" data-close>${t('close')}</button></div>`);
  wireIntegration(dlg, agent, null, ctx);
}

function integrationBody() {
  return `
    <div class="callout">${icon('info', 15)}<span>${t('int_flow')}</span></div>
    <div>
      <div class="code-tabs" role="tablist">
        <button class="active" data-snip="curl">${icon('terminal', 13)}cURL</button>
        <button data-snip="js">${icon('code', 13)}JavaScript</button>
        <button data-snip="py">${icon('code', 13)}Python</button>
        <button data-snip="mcp">${icon('plug', 13)}MCP</button>
      </div>
      <div class="codeblock" style="margin-top:12px"><pre id="snip"></pre><button class="copy-btn" id="copySnip" data-copied="${esc(t('copied'))}">${icon('copy', 12)}<span>${t('copy')}</span></button></div>
    </div>`;
}

function snippets(agent, apiKey, ctx) {
  const origin = location.origin;
  const key = apiKey || 'ABK_KEY';
  const l = lang();
  const text = SAMPLE[l];
  const root = ctx.ui.snap.hubRoot || '/path/to/agent-brain-hub';
  const cid = ctx.ui.customerId;
  return {
    curl: `# 1) recall — before your agent answers
curl -s ${origin}/v1/recall \\
  -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\
  -d '{"customerId":"${cid}","text":"${text}","lang":"${l}"}'
# → { traceId, memories[], suggestedActions[], promptBlock, … }

# 2) remember — after your agent answered
curl -s ${origin}/v1/remember \\
  -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\
  -d '{"traceId":"<traceId from recall>","reply":"<your agent reply>","lang":"${l}"}'

# Also: GET /v1/profile?customerId=${cid} · POST /v1/feedback · POST /v1/chat`,
    js: `import { BrainClient } from '${root}/sdk/brain-client.js';

const brain = new BrainClient({ url: '${origin}', apiKey: '${key}' });

async function answer(customerId, userText) {
  const ctx = await brain.recall({ customerId, text: userText, lang: '${l}' });
  const reply = await myLLM({                 // your own model / framework
    system: 'You are ${agent.name}.\\n' + ctx.promptBlock,
    user: ctx.redactedText,
  });
  await brain.remember({ traceId: ctx.traceId, reply, lang: '${l}' });
  return reply;
}`,
    py: `import requests

BRAIN = "${origin}"
HEADERS = {"Authorization": "Bearer ${key}"}

def answer(customer_id: str, user_text: str) -> str:
    ctx = requests.post(f"{BRAIN}/v1/recall", headers=HEADERS, json={
        "customerId": customer_id, "text": user_text, "lang": "${l}"}).json()
    reply = my_llm(system="You are ${agent.name}.\\n" + ctx["promptBlock"],
                   user=ctx["redactedText"])          # your own model
    requests.post(f"{BRAIN}/v1/remember", headers=HEADERS, json={
        "traceId": ctx["traceId"], "reply": reply, "lang": "${l}"})
    return reply`,
    mcp: `# Claude Code
claude mcp add agent-brain \\
  -e BRAIN_URL=${origin} -e BRAIN_API_KEY=${key} -e BRAIN_LANG=${l} \\
  -- node ${root}/mcp/server.mjs

# Claude Desktop / Cursor — mcpServers in the client config
{
  "mcpServers": {
    "agent-brain": {
      "command": "node",
      "args": ["${root}/mcp/server.mjs"],
      "env": { "BRAIN_URL": "${origin}", "BRAIN_API_KEY": "${key}", "BRAIN_LANG": "${l}" }
    }
  }
}
# Tools: brain_recall · brain_remember · brain_profile · brain_feedback`,
  };
}

function wireIntegration(dlg, agent, apiKey, ctx) {
  const snips = snippets(agent, apiKey, ctx);
  let current = 'curl';
  const show = () => ($('#snip', dlg).textContent = snips[current]);
  $$('.code-tabs button', dlg).forEach((b) => {
    b.onclick = () => {
      current = b.dataset.snip;
      $$('.code-tabs button', dlg).forEach((x) => x.classList.toggle('active', x === b));
      show();
    };
  });
  $('#copySnip', dlg).onclick = (e) => copy(snips[current], e.currentTarget);
  show();
}
