// View: Business value — what the shared brain is worth to the company,
// measured from the audit log (knowledge reuse, questions saved, leaks
// blocked, handoffs, learning) plus the knowledge-flow matrix.
import { $$, esc, api, fmtNum, pageHead } from '../util.js';
import { icon, avatar } from '../icons.js';
import { t, lang } from '../i18n.js';

let pending = null;

export async function render(root, ctx) {
  const L = lang();
  const req = (pending = api(`/api/value?lang=${L}`));
  const v = await req;
  if (req !== pending) return; // a newer render superseded this one
  const s = ctx.ui.snap;
  const k = v.kpis;
  const colorOf = (domain) => s.domains[domain]?.color || '#6366f1';
  const n = (x) => fmtNum(x, L);
  const empty = !k.turns && !k.apiCalls;

  root.innerHTML = `
    ${pageHead(icon('menu', 18), t('nav_value'), t('va_sub'))}
    <div class="page-body">
      ${empty ? `<div class="callout">${icon('info', 15)}<span>${t('va_empty')}</span></div>` : ''}
      <div class="card hero-card">
        <div class="hero-main">
          <div class="ico-tile">${icon('sparkles', 22)}</div>
          <div><div class="hero-num">${n(k.questionsSaved)}</div></div>
        </div>
        <div class="hero-text"><h2>${t('va_hero')}</h2><p>${t('va_hero_sub', { m: n(k.minutesSaved), s: k.secondsPerQuestion })}</p></div>
      </div>
      <div class="kpi-grid">
        ${kpi('repeat', 'info', n(k.crossAgentReuse), t('k_reuse'), t('k_reuse_d'))}
        ${kpi('handoff', 'violet', n(k.handoffs), t('k_handoffs'), t('k_handoffs_d'))}
        ${kpi('thumbsUp', 'success', k.acceptanceRate === null ? '—' : `${Math.round(k.acceptanceRate * 100)}%`, t('k_accept'), t('k_accept_d', { a: n(k.accepted), d: n(k.declined) }))}
        ${kpi('book', '', n(k.skillsLearned), t('k_skills'), t('k_skills_d', { n: n(k.playbookRuns) }))}
        ${kpi('shield', 'danger', n(k.leaksBlocked), t('k_leaks'), t('k_leaks_d'))}
        ${kpi('bot', 'neutral', n(k.agents), t('k_agents'), t('k_agents_d', { c: n(k.connectedAgents), api: n(k.apiCalls) }))}
        ${kpi('database', 'neutral', n(k.facts + k.episodes), t('k_memory'), t('k_memory_d', { f: n(k.facts), e: n(k.episodes), c: n(k.customers) }))}
        ${kpi('bulb', 'warning', n(k.insights), t('k_insights'), t('k_insights_d'))}
      </div>

      <div class="chart-row">
        <div class="card chart-card">
          <div class="card-head"><div class="card-title">${t('ch_flow')}</div><div class="card-sub">${t('ch_flow_d')}</div></div>
          <div class="card-body">${heatmap(v.flow, colorOf)}</div>
        </div>
        <div class="card chart-card">
          <div class="card-head"><div class="card-title">${t('ch_reuse')}</div><div class="card-sub">${t('k_reuse_d')}</div></div>
          <div class="card-body">
            ${reuseBars(v.perAgent, n, colorOf)}
            <div class="card-title" style="margin-top:10px">${t('ch_activity')}</div>
            ${activity(v.daily, n)}
          </div>
        </div>
      </div>

      <div class="chart-row">
        <div class="card chart-card">
          <div class="card-head"><div class="card-title">${t('ch_table')}</div></div>
          <div class="table-card">
            <table class="table">
              <thead><tr><th>${t('th_agent')}</th><th>${t('th_type')}</th><th class="num">${t('st_turns')}</th><th class="num">${t('st_facts')}</th><th class="num">${t('th_reads')}</th><th class="num">${t('th_reused')}</th><th class="num">${t('th_used')}</th><th class="num">${t('th_acc')}</th></tr></thead>
              <tbody>${v.perAgent
                .map((a) => `<tr><td><div class="agent-cell" style="min-width:0">${avatar(a.name, colorOf(a.domain), 24)}<b>${esc(a.name)}</b></div></td><td><span class="badge ${a.kind === 'external' ? 'info' : 'accent'}">${a.kind === 'external' ? t('kind_external') : t('kind_native')}</span></td><td class="num">${n(a.turns)}</td><td class="num">${n(a.factsOwned)}</td><td class="num">${n(a.reads)}</td><td class="num"><b>${n(a.reusedByOthers)}</b></td><td class="num">${n(a.usedFromOthers)}</td><td class="num">${n(a.accepted)} / ${n(a.declined)}</td></tr>`)
                .join('')}</tbody>
            </table>
          </div>
        </div>
        <div class="card chart-card">
          <div class="card-head"><div class="card-title">${t('va_insights')}</div></div>
          <div class="card-body">
            ${v.insights.length ? `<ul class="insights">${v.insights.map((i) => `<li><div class="ico-tile warning">${icon('bulb', 15)}</div><div>${esc(i.text.replace(/^\[Insight\]\s*/, ''))}<small>${esc(i.customer)}</small></div></li>`).join('')}</ul>` : `<div class="empty-state"><div class="ico-tile">${icon('bulb', 20)}</div><p>${t('no_data')}</p></div>`}
          </div>
        </div>
      </div>
    </div>`;
  wireTips(root);
}

function kpi(ic, tone, value, label, detail) {
  return `<div class="card kpi"><div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="ico-tile ${tone}">${icon(ic, 15)}</span></div><div class="kpi-value">${value}</div><div class="kpi-detail">${esc(detail)}</div></div>`;
}

// Writer (rows) × reader (columns), one-hue sequential ramp; zero = dashed empty.
function heatmap(flow, colorOf) {
  const agents = flow.agents;
  const max = Math.max(1, ...flow.matrix.flat());
  const step = (v) => Math.min(4, Math.floor((v / max) * 5 - 1e-9));
  const cols = `grid-template-columns: max-content repeat(${agents.length}, minmax(40px, 1fr))`;
  let html = `<div class="heat" style="${cols}"><div class="rh muted small">${t('ch_flow_writer')}</div>`;
  html += agents.map((a) => `<div class="hd" title="${esc(a.name)}">${esc(a.name)}</div>`).join('');
  flow.matrix.forEach((row, i) => {
    html += `<div class="rh"><span class="dot" style="background:${colorOf(agents[i].domain)}"></span>${esc(agents[i].name)}</div>`;
    row.forEach((val, j) => {
      const tip = `${agents[i].name} → ${agents[j].name}: ${val}`;
      html += val
        ? `<div class="cell h${step(val)} ${i === j ? 'diag' : ''}" data-tip="${esc(tip)}">${val}</div>`
        : `<div class="cell zero ${i === j ? 'diag' : ''}" data-tip="${esc(tip)}"></div>`;
    });
  });
  html += `</div><div class="legend"><span>0</span><span class="ramp">${[0, 1, 2, 3, 4].map((i) => `<i class="h${i}"></i>`).join('')}</span><span>${max}</span></div>`;
  return html;
}

function reuseBars(perAgent, n, colorOf) {
  const rows = perAgent.filter((a) => a.reusedByOthers > 0).sort((a, b) => b.reusedByOthers - a.reusedByOthers);
  if (!rows.length) return `<div class="muted small">${t('no_data')}</div>`;
  const max = Math.max(...rows.map((r) => r.reusedByOthers));
  return `<div class="hbars">${rows
    .map((r) => `<div class="hbar" data-tip="${esc(`${r.name}: ${r.reusedByOthers}`)}"><span class="name"><span class="dot" style="background:${colorOf(r.domain)}"></span>${esc(r.name)}</span><span class="track"><span class="fill" style="width:${(r.reusedByOthers / max) * 100}%"></span></span><span class="val">${n(r.reusedByOthers)}</span></div>`)
    .join('')}</div>`;
}

function activity(daily, n) {
  if (!daily.length) return `<div class="muted small">${t('no_data')}</div>`;
  const max = Math.max(1, ...daily.map((d) => d.turns + d.apiCalls));
  const cols = daily
    .map((d) => {
      const tip = `${d.day} · ${t('s_turns')}: ${n(d.turns)} · ${t('s_api')}: ${n(d.apiCalls)}`;
      const a = d.turns ? `<div class="seg-a" style="height:${(d.turns / max) * 100}%"></div>` : '';
      const b = d.apiCalls ? `<div class="seg-b" style="height:${(d.apiCalls / max) * 100}%"></div>` : '';
      return `<div class="col" data-tip="${esc(tip)}">${a}${b}</div>`;
    })
    .join('');
  const labels = daily.map((d) => `<span>${d.day.slice(5).replace('-', '/')}</span>`).join('');
  return `<div><div class="cols-chart">${cols}</div><div class="col-labels">${labels}</div></div>
    <div class="legend"><span><i class="sw" style="background:var(--series-1)"></i>${t('s_turns')}</span><span><i class="sw" style="background:var(--series-2)"></i>${t('s_api')}</span></div>`;
}

function wireTips(root) {
  const tip = document.getElementById('vizTip');
  $$('[data-tip]', root).forEach((el) => {
    el.addEventListener('mouseenter', () => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
    });
    el.addEventListener('mousemove', (e) => {
      tip.style.left = `${Math.min(window.innerWidth - 290, e.clientX + 14)}px`;
      tip.style.top = `${e.clientY + 16}px`;
    });
    el.addEventListener('mouseleave', () => (tip.hidden = true));
  });
}
