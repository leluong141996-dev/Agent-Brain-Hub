// View: Audit log — every read, write, block and API call into the brain.
import { $, $$, esc, api, fmtTime, pageHead } from '../util.js';
import { icon } from '../icons.js';
import { t, lang } from '../i18n.js';

const OPS = ['read', 'write', 'blocked', 'recall', 'remember', 'chat', 'handoff', 'feedback'];
let filter = 'all';
let query = '';

export async function render(root, ctx) {
  const log = await api('/api/audit?limit=500');
  const customers = Object.fromEntries(ctx.ui.snap.customers.map((c) => [c.id, c.name]));
  const count = (o) => (o === 'all' ? log.length : log.filter((e) => e.op === o).length);
  root.innerHTML = `
    ${pageHead(icon('menu', 18), t('nav_audit'), t('au_sub'), `<button class="btn" id="auRefresh">${icon('refresh')}<span>${t('refresh')}</span></button>`)}
    <div class="page-body">
      <div class="toolbar">
        <div class="segmented" role="tablist">
          ${['all', ...OPS].map((o) => `<button type="button" data-op="${o}" class="${o === filter ? 'active' : ''}">${o === 'all' ? t('au_all') : o}<span class="count">${count(o)}</span></button>`).join('')}
        </div>
        <span class="spacer"></span>
        <label class="search">${icon('search', 15)}<input class="input" id="auSearch" type="search" placeholder="${esc(t('au_search'))}" value="${esc(query)}" /></label>
      </div>
      <div class="card table-card audit-table" id="auTable"></div>
    </div>`;

  const draw = () => {
    const q = query.trim().toLowerCase();
    const rows = log.filter((e) => (filter === 'all' || e.op === filter) && (!q || [e.agentName, e.sourceName, customers[e.customerId], e.customerId, e.relation, e.kind, e.op].filter(Boolean).join(' ').toLowerCase().includes(q)));
    $('#auTable', root).innerHTML = `
      <table class="table">
        <thead><tr><th>${t('th_time')}</th><th>${t('th_op')}</th><th>${t('th_agent')}</th><th>${t('th_customer')}</th><th>${t('th_item')}</th><th>${t('th_from')}</th><th>${t('th_scope')}</th></tr></thead>
        <tbody>${
          rows.length
            ? rows
                .map(
                  (e) => `<tr>
              <td class="time-cell">${fmtTime(e.at, lang())}</td>
              <td><span class="op op-${e.op}">${e.op}</span></td>
              <td>${esc(e.agentName || e.agentId || '—')}</td>
              <td>${esc(customers[e.customerId] || e.customerId || '—')}</td>
              <td>${esc([e.kind, e.relation, e.action, e.actionId, e.accepted === undefined ? null : e.accepted ? '✓' : '✗', e.via].filter(Boolean).join(' · ') || '—')}</td>
              <td class="${e.sourceName ? '' : 'muted'}">${esc(e.sourceName || '—')}</td>
              <td>${e.scope ? `<span class="badge scope ${e.scope}">${e.scope}</span>` : ''}</td>
            </tr>`
                )
                .join('')
            : `<tr><td colspan="7"><div class="empty-state"><div class="ico-tile">${icon('shield', 20)}</div><p>${t('au_empty')}</p></div></td></tr>`
        }</tbody>
      </table>`;
  };
  draw();
  $$('.segmented button', root).forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.op;
      $$('.segmented button', root).forEach((x) => x.classList.toggle('active', x === b));
      draw();
    };
  });
  $('#auSearch', root).oninput = (e) => {
    query = e.target.value;
    draw();
  };
  $('#auRefresh', root).onclick = () => render(root, ctx);
}
