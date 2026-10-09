// Hippocampus — Memory Encoding & Consolidation. Online: extract facts and
// encode salient moments right away. Sleep: hierarchical summarization of
// working-memory sessions into long-term episodic memories.
import { extractFactsRuleBased, factToText } from './ontology.js';
import { relationOf, normalizeName } from './registry.js';
import { writeFact, addEpisode, WRITE_REASONS } from './neocortex.js';
import { delegateWrite } from './corpusCallosum.js';
import { domainOf, actionLabel } from '../agents.js';
import { DAY } from '../clock.js';
import { truncate } from '../text.js';
import { tr } from '../i18n.js';

export function retentionDays(agent) {
  return agent.retentionDays !== undefined ? agent.retentionDays : domainOf(agent).retentionDays;
}

function episodeScope(agent) {
  return domainOf(agent).episodeScope;
}

// Rule facts win; an LLM fact is added only if it says something new. For a
// single-valued relation, two phrasings from the SAME message are one fact,
// not a contradiction ("no car for 3 days" vs "in the shop for 3 days").
function mergeFacts(B, rule, llm) {
  const out = [...rule];
  for (const f of llm || []) {
    const single = (relationOf(B, normalizeName(f.relation))?.card ?? 'one') === 'one';
    if (!out.some((r) => normalizeName(r.relation) === normalizeName(f.relation) && (single || r.value.toLowerCase() === String(f.value).toLowerCase()))) {
      out.push({ ...f });
    }
  }
  return out;
}

export async function encodeOnline(B, t, { customerId, agent, text, salience, traceId, llmFactsPromise, explicitFacts = [], readOnly = false }) {
  if (readOnly) {
    t.step('hippocampus', t.L(`${agent.name} chỉ có quyền đọc → không ghi ký ức`, `${agent.name} is read-only → nothing written`, `${agent.name}は読み取り専用 → 記憶を書き込まない`), { permission: 'write=false' }, { from: 'output', status: 'warn' });
    return { results: [], salient: null };
  }
  const rule = text ? extractFactsRuleBased(text) : [];
  const llm = llmFactsPromise ? await llmFactsPromise : null;
  const extracted = mergeFacts(B, [...explicitFacts, ...rule], llm);
  const by = llm ? t.L('rule + LLM', 'rule + LLM') : t.L('rule-based', 'rule-based');
  t.step('hippocampus', t.L(`Mã hoá: trích ${extracted.length} fact (${by})`, `Encoding: extracted ${extracted.length} facts (${by})`, `符号化：事実を${extracted.length}件抽出（${by}）`), {
    extracted: extracted.map((f) => `${f.relation} = ${f.value}`),
    extractor: llm ? 'rule + LLM' : 'rule',
  }, { from: 'output' });

  const results = [];
  for (const f of extracted) {
    const r = writeFact(B, f, { agent, customerId });
    results.push(r);
    if (r.decision) {
      const [win, lose] = r.action === 'arbitrated' ? [r.fact, r.against] : [r.against, r.fact];
      t.step('neocortex', t.L(`Phân xử (${r.decision.policy}): giữ "${win.value}", bỏ "${lose.value}"`, `Arbitration (${r.decision.policy}): kept "${win.value}", outvoted "${lose.value}"`, `調停（${r.decision.policy}）：「${win.value}」を採用、「${lose.value}」を不採用`), { relation: r.decision.relation, policy: r.decision.policy }, { from: 'hippocampus' });
    }
    if (r.delegated && r.fact) delegateWrite(B, t, { fact: r.fact, fromAgent: agent });
  }

  let salient = null;
  if (salience.priority === 'high' || salience.priority === 'critical') {
    const now = B.clock.now();
    const days = retentionDays(agent);
    salient = addEpisode(B, {
      customerId,
      agentId: agent.id,
      ownerDomain: agent.domain,
      scope: episodeScope(agent),
      kind: 'salient',
      text: t.L(
        `[${agent.name}] Khoảnh khắc ưu tiên ${salience.priority}: "${truncate(text, 140)}"`,
        `[${agent.name}] ${salience.priority} priority moment: "${truncate(text, 140)}"`,
        `[${agent.name}] 優先度 ${salience.priority} の場面：「${truncate(text, 140)}」`
      ),
      importance: salience.priority === 'critical' ? 0.95 : 0.8,
      salience,
      traceId,
      expiresAt: days ? now + days * DAY : null,
    });
  }

  if (results.length || salient) {
    const written = results.filter((r) => r.fact).length;
    t.step('neocortex', t.L(`Ghi ${written} fact${salient ? ' + 1 episode ưu tiên' : ''}`, `Wrote ${written} facts${salient ? ' + 1 priority episode' : ''}`, `事実を${written}件書き込み${salient ? '＋優先エピソード1件' : ''}`), {
      writes: results.map((r) => ({
        action: r.action,
        fact: r.fact ? factToText(r.fact, t.lang) : `${r.input?.relation}: ${r.input?.value}`,
        scope: r.fact?.scope,
        owner: r.fact?.ownerDomain,
        reason: describeReason(r.reason, t.lang),
        against: r.against ? factToText(r.against, t.lang) : null,
      })),
      salientEpisode: salient ? salient.text : null,
    }, { from: 'hippocampus', status: results.some((r) => r.action === 'conflict') ? 'warn' : 'ok' });
  }
  return { results, salient };
}

export function describeReason(code, lang) {
  if (!code) return null;
  return WRITE_REASONS[code] ? tr(WRITE_REASONS[code], lang) : code;
}

export function encodeOutcome(B, t, { record, actionId, accepted }) {
  const agent = B.state.agents.find((a) => a.id === record.agentId) || { id: record.agentId, name: record.agentId, domain: record.domain };
  const days = retentionDays(agent);
  const now = B.clock.now();
  const label = actionLabel(actionId, t.lang);
  const ep = addEpisode(B, {
    customerId: record.customerId,
    agentId: agent.id,
    ownerDomain: agent.domain,
    scope: episodeScope(agent),
    kind: 'outcome',
    text: t.L(
      `[${agent.name}] Gợi ý "${label}" → khách ${accepted ? 'ĐỒNG Ý' : 'TỪ CHỐI'} (intent ${record.intent})`,
      `[${agent.name}] Suggested "${label}" → customer ${accepted ? 'ACCEPTED' : 'DECLINED'} (intent ${record.intent})`,
      `[${agent.name}] 提案「${label}」→ お客様は${accepted ? '承諾' : '辞退'}（意図 ${record.intent}）`
    ),
    importance: 0.6,
    traceId: record.traceId,
    expiresAt: days ? now + days * DAY : null,
  });
  t.step('hippocampus', t.L('Mã hoá outcome thành episodic memory', 'Encoded the outcome as an episodic memory', '結果をエピソード記憶として符号化'), { episode: ep.text }, { from: 'basal_ganglia' });
  return ep;
}

// Sleep: turn un-consolidated working-memory turns into session episodes.
export async function consolidate(B, t, { customerId }) {
  const wm = B.state.working[customerId];
  const pending = (wm?.turns || []).filter((x) => !x.consolidated);
  const groups = new Map();
  for (const turn of pending) {
    const k = `${turn.sessionId}|${turn.agentId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(turn);
  }
  t.step('hippocampus', t.L(`Gom ${pending.length} lượt hội thoại thành ${groups.size} phiên`, `Grouped ${pending.length} turns into ${groups.size} sessions`, `${pending.length}ターンを${groups.size}セッションに集約`), {
    turns: pending.length,
    sessions: groups.size,
    method: 'hierarchical: turn → session → insight',
  }, { from: 'input' });

  const created = [];
  for (const [, turns] of groups) {
    const agentId = turns[0].agentId;
    const agent = B.state.agents.find((a) => a.id === agentId) || { id: agentId, name: agentId, domain: 'personal' };
    const transcript = turns.map((x) => `${x.role === 'user' ? 'Customer' : 'Agent'}: ${x.text}`).join('\n');
    const llmSummary = await B.llm.summarize(transcript, t.lang);
    const userLines = turns.filter((x) => x.role === 'user').map((x) => truncate(x.text, 90));
    const summary = llmSummary || t.L(`Khách trao đổi với ${agent.name}: ${userLines.join(' / ')}`, `Customer talked with ${agent.name}: ${userLines.join(' / ')}`, `お客様は${agent.name}と会話：${userLines.join(' / ')}`);
    const days = retentionDays(agent);
    const now = B.clock.now();
    const ep = addEpisode(B, {
      customerId,
      agentId,
      ownerDomain: agent.domain,
      scope: episodeScope(agent),
      kind: 'session',
      text: `[${agent.name}] ${summary}`,
      importance: Math.min(1, 0.4 + turns.length * 0.05 + (wm.salience?.priority === 'high' ? 0.2 : 0)),
      turnCount: turns.length,
      expiresAt: days ? now + days * DAY : null,
    });
    created.push(ep);
    for (const x of turns) x.consolidated = true;
  }
  // Working memory keeps the latest few turns after consolidation, plus every
  // turn that is still pending: turns that arrived while this sleep waited on
  // the summarizer were not part of it, and must wait for the next one.
  if (wm) {
    const n = wm.turns.length;
    wm.turns = wm.turns.filter((x, i) => !x.consolidated || i >= n - 6);
  }
  if (created.length) {
    t.step('neocortex', t.L(`Lưu ${created.length} episode phiên vào long-term`, `Stored ${created.length} session episodes in long-term memory`, `セッションエピソード${created.length}件を長期記憶に保存`), {
      episodes: created.map((e) => ({ text: truncate(e.text, 120), scope: e.scope, expires: e.expiresAt ? new Date(e.expiresAt).toISOString().slice(0, 10) : '∞' })),
      summarizer: B.llm.available ? 'LLM' : 'extractive',
    }, { from: 'hippocampus' });
  }
  return created;
}
