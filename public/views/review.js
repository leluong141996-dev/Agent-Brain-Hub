// View: Review queue (v0.7) — conflicts a human should decide, automatic
// decisions that can be undone, and new relations worth promoting.
import { $$, esc, api, pageHead, toast, LOCALES } from '../util.js';
import { icon } from '../icons.js';
import { t, lang } from '../i18n.js';

const when = (ts) => (ts ? new Date(ts).toLocaleString(LOCALES[lang()]) : '');

export async function render(root, ctx) {
  const r = await api(`/api/review?lang=${lang()}`);
  const side = (s, button) => `<div class="rv-side">
      <div class="rv-value">${esc(s.value)}</div>
      <div class="muted small">${esc(s.agentName)} · ${t('rv_trust')} ${s.trust.toFixed(2)} · ${esc(when(s.at))}</div>
      ${s.evidence ? `<div class="small rv-evidence">“${esc(s.evidence)}”</div>` : ''}
      ${button}
    </div>`;
  const keep = (s) => `<button class="btn sm" data-keep="${s.id}">${icon('check', 13)}<span>${t('rv_keep')}</span></button>`;
  const conflicts = r.conflicts
    .map((c) => `<div class="card rv-card"><div class="rv-head"><b>${esc(c.label)}</b> <span class="muted small">· ${esc(c.customerName)}</span></div>
      <div class="rv-pair">${side(c.a, keep(c.a))}${side(c.b, keep(c.b))}</div></div>`)
    .join('');
  const decisions = r.decisions
    .map((d) => `<tr>
      <td>${esc(d.label)}</td>
      <td><b>${esc(d.winner.value)}</b> <span class="muted small">(${esc(d.winner.agentName)})</span></td>
      <td class="muted"><s>${esc(d.loser.value)}</s> <span class="small">(${esc(d.loser.agentName)})</span></td>
      <td><span class="badge">${esc(t('rv_pol_' + d.policy))}</span></td>
      <td>${esc(d.customerName)}</td>
      <td class="time-cell">${esc(when(d.at))}</td>
      <td><button class="btn sm ghost" data-undo="${d.id}">${icon('reset', 13)}<span>${t('rv_undo')}</span></button></td>
    </tr>`)
    .join('');
  const suggestions = r.suggestions
    .map((s) => `<li><b>${esc(s.labelText)}</b> <code class="muted">${esc(s.name)}</code> · ${t('rv_uses', { uses: s.uses, customers: s.customers.length })}${s.examples?.length ? ` · <span class="muted">${esc(s.examples.join(', '))}</span>` : ''}</li>`)
    .join('');

  root.innerHTML = `
    ${pageHead(icon('check', 18), t('nav_review'), t('rv_sub'))}
    <div class="page-body">
      <div class="section-label">${t('rv_conflicts', { n: r.conflicts.length })}</div>
      ${conflicts || `<p class="muted">${t('rv_no_conflicts')}</p>`}
      <div class="section-label">${t('rv_decisions', { n: r.decisions.length })}</div>
      ${
        decisions
          ? `<div class="card table-card"><table class="table"><thead><tr><th>${t('th_relation')}</th><th>${t('rv_kept')}</th><th>${t('rv_outvoted')}</th><th>${t('rv_policy')}</th><th>${t('th_customer')}</th><th>${t('th_time')}</th><th></th></tr></thead><tbody>${decisions}</tbody></table></div>`
          : `<p class="muted">${t('rv_no_decisions')}</p>`
      }
      <div class="section-label">${t('rv_suggestions')}</div>
      ${suggestions ? `<ul class="rv-suggest">${suggestions}</ul><div><a href="#settings" class="btn sm">${icon('sliders', 13)}<span>${t('rv_open_schema')}</span></a></div>` : `<p class="muted">${t('rv_no_suggestions')}</p>`}
    </div>`;

  const act = (path, body) => async () => {
    await api(path, body);
    toast(esc(t('rv_done')), 'success', icon('check'));
    await ctx.refresh();
  };
  $$('[data-keep]', root).forEach((b) => (b.onclick = act('/api/review/resolve', { factId: b.dataset.keep })));
  $$('[data-undo]', root).forEach((b) => (b.onclick = act('/api/review/undo', { decisionId: b.dataset.undo })));
}
