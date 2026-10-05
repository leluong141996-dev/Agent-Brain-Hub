// The Brain: one centralized memory shared by many agents.
//  • Awake loop (per request):  Thalamus → Brainstem → Amygdala → [Corpus callosum]
//    → Prefrontal → Cerebellum → RAS ⇄ Neocortex → Basal ganglia → Prefrontal (LLM)
//    → Brainstem → output → Hippocampus → Neocortex → Cerebellum
//  • Sleep loop (end of session / scheduled): Hippocampus → Forgetting → DMN → Cerebellum
//
// Three ways for an agent to use the brain:
//  • think()    — native agent: the brain also generates the reply (LLM or template)
//  • recall()   — connected agent: returns a context package for its own LLM
//  • remember() — connected agent: hands back the turn so the brain can learn
// Every entry point takes `lang` ('vi' | 'en' | 'ja'): it localizes replies,
// trace labels and snapshot text. Memory itself is language-agnostic.
import crypto from 'node:crypto';
import { thalamus } from './thalamus.js';
import { brainstemIn, brainstemOut, crisisReply, redact } from './brainstem.js';
import { amygdala } from './amygdala.js';
import { updateWorkingMemory, recordReply, hotTurns, ensureWorking, taskName } from './prefrontal.js';
import { matchSkill, recordOutcome, seedSkills, rollbackSkill, labelOf, skillName } from './cerebellum.js';
import { retrieve } from './ras.js';
import { selectActions, learn } from './basalGanglia.js';
import { handoff } from './corpusCallosum.js';
import { encodeOnline, encodeOutcome, consolidate, describeReason } from './hippocampus.js';
import { forget } from './forgetting.js';
import { reflect } from './dmn.js';
import { seedGlobal, resolveConflict } from './neocortex.js';
import { extractFactsRuleBased, factToText, factValue, RELATIONS } from './ontology.js';
import { templateReply, buildPrompt, contextBlock, memoryInstructions } from './respond.js';
import { audit, auditRetrieval } from './audit.js';
import { DOMAINS, DEFAULT_PERMISSIONS, actionLabel } from '../agents.js';
import { Clock } from '../clock.js';
import { estimateTokens } from '../text.js';
import { normLang, tr, LANGUAGE_NAME } from '../i18n.js';

const err = (message, status) => Object.assign(new Error(message), { status });
const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');
const newKey = () => `abk_${crypto.randomBytes(18).toString('hex')}`;
const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

export class Brain {
  constructor({ store, bus, llm, deterministic = false }) {
    this.store = store;
    this.bus = bus;
    this.llm = llm;
    this.deterministic = deterministic;
    this.clock = new Clock(store.state.clockOffsetMs || 0);
    seedGlobal(this);
    seedSkills(this);
    for (const a of this.state.agents) {
      a.permissions ||= { ...DEFAULT_PERMISSIONS };
      a.kind ||= 'native';
      if (!a.keyHash) this.issueKey(a); // keys of seeded agents are revealed by rotating
    }
  }

  get state() {
    return this.store.state;
  }

  agentName(id) {
    return this.state.agents.find((a) => a.id === id)?.name || id;
  }

  agentDomain(id) {
    return this.state.agents.find((a) => a.id === id)?.domain || null;
  }

  getAgent(id) {
    const a = this.state.agents.find((x) => x.id === id);
    if (!a) throw err(`agent "${id}" not found`, 404);
    return a;
  }

  // ---------------- Usage counters (company-value metrics) ----------------
  count(agentId, field, n = 1) {
    const s = (this.state.stats ||= { totals: {}, byAgent: {}, daily: {} });
    s.totals[field] = (s.totals[field] || 0) + n;
    if (agentId) {
      const a = (s.byAgent[agentId] ||= {});
      a[field] = (a[field] || 0) + n;
    }
    const d = (s.daily[dayOf(this.clock.now())] ||= {});
    d[field] = (d[field] || 0) + n;
  }

  // ---------------- Shared perception: Thalamus → … → Basal ganglia ----------------
  perceive(t, { agentId, customerId, text, lang }) {
    const { agent, newSession, switchedFrom } = thalamus(this, t, { agentId, customerId, text });
    const guard = brainstemIn(this, t, text);
    const clean = guard.text;
    const salience = amygdala(this, t, { text: clean, customerId });
    let handoffPkg = null;
    if (switchedFrom) {
      handoffPkg = handoff(this, t, { customerId, fromAgentId: switchedFrom, toAgent: agent });
      this.count(agent.id, 'handoffs');
      audit(this, { op: 'handoff', agentId: agent.id, sourceAgentId: switchedFrom, customerId, traceId: t.id, facts: handoffPkg.facts.length, withheld: handoffPkg.withheld });
    }
    const { wm, intent } = updateWorkingMemory(this, t, { customerId, agent, text: clean, salience, newSession, traceId: t.id });

    // Executive loop: procedural → episodic → semantic.
    const skill = matchSkill(this, t, { agent, intent: intent.intent });
    const retrieval = retrieve(this, t, { customerId, agent, query: clean, intent: intent.intent });
    auditRetrieval(this, { agent, customerId, traceId: t.id, selected: retrieval.selected, blocked: retrieval.blocked });
    const utteranceFacts = extractFactsRuleBased(clean);
    const factSignals = new Map();
    for (const s of retrieval.selected) if (s.kind === 'semantic' && s.relation && s.status !== 'conflicted') factSignals.set(s.relation, s.value);
    for (const f of utteranceFacts) factSignals.set(f.relation, f.value);
    const actions = selectActions(this, t, { agent, intent: intent.intent, facts: factSignals, salience, skill });
    this.count(agent.id, 'suggestions', actions.length);
    if (skill) this.count(agent.id, 'playbookRuns');

    const ctx = { agent, lang, intent: intent.intent, salience, selected: retrieval.selected, actions, skill, handoffPkg, utteranceFacts, hot: hotTurns(this, wm, agent).slice(0, -1) };
    return { agent, guard, clean, salience, handoffPkg, wm, intent, skill, retrieval, actions, ctx };
  }

  saveTrace(t, { customerId, agent, intent, actions, skill, userText }) {
    this.state.traces[t.id] = {
      traceId: t.id,
      customerId,
      agentId: agent.id,
      domain: agent.domain,
      intent,
      actions: actions.map((a) => ({ id: a.id })),
      skillId: skill?.id || null,
      userText,
      replied: false,
      feedback: [],
      at: this.clock.now(),
    };
    this.pruneTraces();
  }

  async encode(t, { agent, customerId, text, salience, llmFactsPromise, explicitFacts = [] }) {
    const encoded = await encodeOnline(this, t, { customerId, agent, text, salience, traceId: t.id, llmFactsPromise, explicitFacts, readOnly: agent.permissions?.write === false });
    for (const r of encoded.results) {
      if (!r.fact) continue;
      audit(this, { op: 'write', agentId: agent.id, customerId, traceId: t.id, kind: 'semantic', itemId: r.fact.id, relation: r.fact.relation, action: r.action, scope: r.fact.scope });
      this.count(agent.id, 'factWrites');
    }
    return encoded;
  }

  learnedView(encoded, lang) {
    return encoded.results.map((r) => ({
      action: r.action,
      text: r.fact ? factToText(r.fact, lang) : `${r.input?.relation}: ${r.input?.value}`,
      reason: describeReason(r.reason, lang),
    }));
  }

  // ---------------- think(): the brain answers (native agents) ----------------
  async think({ agentId, customerId = 'kh-001', text, lang, via = 'ui' }) {
    lang = normLang(lang);
    text = String(text || '').trim();
    if (!text) throw err('text is required', 400);
    const t = this.bus.trace('awake', { agentId, customerId, lang });
    const p = this.perceive(t, { agentId, customerId, text, lang });
    const { agent, guard, clean, salience, wm, intent, skill, retrieval, actions, ctx } = p;
    // Start LLM fact extraction now; Hippocampus awaits it after the reply.
    const llmFactsPromise = this.llm.available && agent.permissions?.write !== false ? this.llm.extractFacts(clean) : null;

    let reply;
    let mode;
    let llmInfo = null;
    if (guard.crisis) {
      reply = crisisReply(lang);
      mode = 'reflex';
    } else {
      const system = buildPrompt(ctx);
      const res = await this.llm.generate({ system, messages: [{ role: 'user', content: clean }], effort: skill ? 'low' : 'medium' });
      if (res) {
        reply = res.text;
        llmInfo = { model: res.model, inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens };
      } else {
        reply = templateReply(ctx);
      }
      mode = skill ? 'playbook' : 'reasoning';
      t.step('prefrontal', skill
        ? t.L(`Thực thi playbook "${skillName(skill, 'vi')}"`, `Running playbook "${skillName(skill, 'en')}"`, `プレイブック「${skillName(skill, 'ja')}」を実行`)
        : t.L('Suy luận & sinh câu trả lời', 'Reasoning & generating the reply', '推論・応答を生成'), {
        mode,
        generator: res ? this.llm.label : 'template (offline)',
        promptTokens: estimateTokens(system),
        contextItems: retrieval.selected.length,
        llm: llmInfo,
      }, { from: 'basal_ganglia' });
    }
    reply = brainstemOut(this, t, reply, agent);
    t.step('output', t.L('Phản hồi tới khách', 'Reply sent to the customer', 'お客様へ応答'), { reply }, { from: 'brainstem' });
    recordReply(this, { customerId, agent, text: reply, traceId: t.id });

    // After acting: extract new facts, store outcome, consider promotion.
    const encoded = await this.encode(t, { agent, customerId, text: clean, salience, llmFactsPromise });
    this.saveTrace(t, { customerId, agent, intent: intent.intent, actions, skill, userText: clean });
    this.state.traces[t.id].replied = true;
    t.step('prefrontal', t.L('Lưu outcome vào Working Memory', 'Outcome stored in working memory', '結果をワーキングメモリに保存'), {
      pendingFeedback: actions.map((a) => a.label),
      activeTask: taskName(wm.activeTask, lang),
    }, { from: 'neocortex' });
    this.count(agent.id, 'turns');
    audit(this, { op: 'chat', agentId: agent.id, customerId, traceId: t.id, via });
    if (via === 'api') this.bus.emit('conversation', { agentId: agent.id, customerId, user: text, reply, via, traceId: t.id });

    this.store.save();
    const end = t.end({ mode, intent: intent.intent });
    return {
      traceId: t.id,
      lang,
      reply,
      mode,
      agent: { id: agent.id, name: agent.name },
      intent,
      salience,
      handoff: p.handoffPkg,
      skill: skill ? { id: skill.id, name: skillName(skill, lang), version: skill.version } : null,
      actions,
      retrieval: { selected: retrieval.selected, excluded: retrieval.excluded, tokens: retrieval.tokens, ms: retrieval.ms },
      learned: this.learnedView(encoded, lang),
      redactions: guard.redactions,
      steps: t.steps,
      ms: end.ms,
    };
  }

  // ---------------- recall(): context package for a connected agent ----------------
  recall({ agentId, customerId = 'kh-001', text, lang }) {
    lang = normLang(lang);
    text = String(text || '').trim();
    if (!text) throw err('text is required', 400);
    const t = this.bus.trace('recall', { agentId, customerId, lang });
    const p = this.perceive(t, { agentId, customerId, text, lang });
    const { agent, clean, salience, intent, skill, retrieval, actions, ctx } = p;
    const promptBlock = [
      `Reply in ${LANGUAGE_NAME[lang]}.`,
      ...memoryInstructions(),
      '',
      contextBlock(ctx),
    ].join('\n');
    t.step('output', t.L('Trả gói ngữ cảnh cho agent bên ngoài', 'Context package returned to the external agent', '外部エージェントへコンテキストを返却'), {
      agent: agent.name,
      memories: retrieval.selected.length,
      promptTokens: estimateTokens(promptBlock),
      suggestedActions: actions.map((a) => a.id),
    }, { from: 'basal_ganglia' });
    this.saveTrace(t, { customerId, agent, intent: intent.intent, actions, skill, userText: clean });
    this.count(agent.id, 'recalls');
    audit(this, { op: 'recall', agentId: agent.id, customerId, traceId: t.id });
    this.store.save();
    const end = t.end({ intent: intent.intent });
    return {
      traceId: t.id,
      lang,
      agent: { id: agent.id, name: agent.name },
      crisis: p.guard.crisis,
      redactedText: clean,
      intent,
      salience: { priority: salience.priority, sentiment: salience.sentiment, urgency: salience.urgency, churnRisk: salience.churnRisk, vip: salience.vip },
      handoff: p.handoffPkg,
      playbook: skill ? { id: skill.id, name: skillName(skill, lang), version: skill.version, steps: skill.steps.map((s) => labelOf(s, lang)) } : null,
      memories: retrieval.selected.map((s) => ({ kind: s.kind, text: s.text, relation: s.relation || null, scope: s.scope, from: s.source || null, tier: s.tier, score: s.score, conflicted: s.status === 'conflicted' })),
      suggestedActions: actions.map((a) => ({ id: a.id, label: a.label, score: a.score })),
      promptBlock,
      steps: t.steps,
      ms: end.ms,
    };
  }

  // ---------------- remember(): a connected agent reports the turn ----------------
  async remember({ agentId, customerId = 'kh-001', traceId, userText, reply, facts = [], outcome, lang }) {
    lang = normLang(lang);
    const record = traceId ? this.state.traces[traceId] : null;
    if (traceId && !record) throw err('trace not found (it may have expired); send userText instead', 404);
    if (record && record.agentId !== agentId) throw err('trace belongs to another agent', 403);
    if (!record && !userText && !facts.length) throw err('provide traceId, userText or facts', 400);
    const t = this.bus.trace('remember', { agentId, customerId, lang });
    const agent = this.getAgent(agentId);
    customerId = record?.customerId || customerId;
    if (!this.state.customers[customerId]) this.state.customers[customerId] = { id: customerId, name: customerId, vip: false };

    // Without a prior recall(), the user turn enters through the normal gateway.
    let text = record?.userText || '';
    let salience = { priority: 'normal', sentiment: 0, urgency: 0 };
    if (!record && userText) {
      const guard = brainstemIn(this, t, userText);
      text = guard.text;
      salience = amygdala(this, t, { text, customerId });
      updateWorkingMemory(this, t, { customerId, agent, text, salience, newSession: !this.state.working[customerId]?.sessionId, traceId: t.id });
    } else {
      t.step('thalamus', t.L(`Nhận lượt hội thoại từ ${agent.name}`, `Turn received from ${agent.name}`, `${agent.name}から会話ターンを受信`), { agent: agent.name, customer: customerId, linkedTrace: traceId || null }, { from: 'input' });
    }
    let cleanReply = null;
    if (reply) {
      cleanReply = redact(String(reply)).text;
      recordReply(this, { customerId, agent, text: cleanReply, traceId: traceId || t.id });
      if (record) record.replied = true;
    }
    const explicitFacts = (Array.isArray(facts) ? facts : [])
      .filter((f) => f && RELATIONS[f.relation] && f.value)
      .map((f) => ({ relation: f.relation, value: String(f.value), entity: RELATIONS[f.relation].entity, isUpdate: !!f.isUpdate }));
    const llmFactsPromise = text && this.llm.available && agent.permissions?.write !== false ? this.llm.extractFacts(text) : null;
    const encoded = await this.encode(t, { agent, customerId, text, salience, llmFactsPromise, explicitFacts });

    let feedback = null;
    if (outcome?.actionId && record) {
      feedback = this.applyFeedback(t, record, outcome.actionId, !!outcome.accepted, lang);
    }
    this.count(agent.id, 'remembers');
    this.count(agent.id, 'turns');
    audit(this, { op: 'remember', agentId: agent.id, customerId, traceId: traceId || t.id });
    if (text || cleanReply) this.bus.emit('conversation', { agentId: agent.id, customerId, user: text, reply: cleanReply, via: 'api', traceId: traceId || t.id });
    this.store.save();
    const end = t.end();
    return { traceId: t.id, linkedTrace: traceId || null, learned: this.learnedView(encoded, lang), feedback, steps: t.steps, ms: end.ms };
  }

  // ---------------- Feedback ----------------
  applyFeedback(t, record, actionId, accepted, lang) {
    if (!record.actions.some((a) => a.id === actionId)) throw err('action does not belong to this trace', 400);
    if (record.feedback.some((f) => f.actionId === actionId)) return { duplicate: true };
    const label = actionLabel(actionId, lang);
    const st = learn(this, { actionId, intent: record.intent, accepted });
    t.step('basal_ganglia', t.L(`Học từ phản hồi: ${accepted ? 'ĐỒNG Ý' : 'TỪ CHỐI'} "${label}"`, `Learning from feedback: ${accepted ? 'ACCEPTED' : 'DECLINED'} "${label}"`, `フィードバックから学習：「${label}」を${accepted ? '承諾' : '辞退'}`), {
      bandit: { key: `${actionId}|${record.intent}`, ...st, mean: +(st.alpha / (st.alpha + st.beta)).toFixed(2) },
    }, { from: 'input' });
    record.feedback.push({ actionId, accepted, at: this.clock.now() });
    const wm = ensureWorking(this, record.customerId);
    wm.outcomes.push({ actionId, accepted, at: this.clock.now() });
    if (wm.outcomes.length > 20) wm.outcomes.shift();
    encodeOutcome(this, t, { record, actionId, accepted });
    const agent = this.state.agents.find((a) => a.id === record.agentId) || { id: record.agentId, domain: record.domain };
    const promoted = recordOutcome(this, t, { agent, intent: record.intent, actionId, success: accepted });
    this.count(record.agentId, accepted ? 'accepted' : 'declined');
    if (promoted) this.count(record.agentId, 'skillsPromoted');
    audit(this, { op: 'feedback', agentId: record.agentId, customerId: record.customerId, traceId: record.traceId, actionId, accepted });
    return { bandit: st, promoted: promoted ? { name: skillName(promoted, lang), version: promoted.version } : null };
  }

  feedback({ traceId, actionId, accepted, lang, agentId }) {
    lang = normLang(lang);
    const record = this.state.traces[traceId];
    if (!record) throw err('trace not found', 404);
    if (agentId && record.agentId !== agentId) throw err('trace belongs to another agent', 403);
    const t = this.bus.trace('feedback', { traceId, lang });
    const r = this.applyFeedback(t, record, actionId, accepted, lang);
    this.store.save();
    t.end();
    return { ...r, steps: t.steps };
  }

  // ---------------- Sleep loop ----------------
  async sleep({ customerId = 'kh-001', lang } = {}) {
    lang = normLang(lang);
    const t = this.bus.trace('sleep', { customerId, lang });
    const episodes = await consolidate(this, t, { customerId });
    const forgotten = forget(this, t);
    const reflection = await reflect(this, t, { customerId });
    this.count(null, 'sleeps');
    this.store.save();
    t.end();
    return {
      traceId: t.id,
      consolidated: episodes.length,
      forgotten,
      insights: reflection.insights.map((e) => e.text),
      promoted: reflection.promoted.map((s) => `${skillName(s, lang)} v${s.version}`),
      steps: t.steps,
    };
  }

  advanceClock(days) {
    this.clock.advanceDays(days);
    this.state.clockOffsetMs = this.clock.offsetMs;
    this.store.save();
    return this.clock.now();
  }

  // ---------------- Agents, keys & permissions ----------------
  issueKey(agent) {
    const key = newKey();
    agent.keyHash = hashKey(key);
    agent.keyHint = `${key.slice(0, 8)}…${key.slice(-4)}`;
    agent.keyIssuedAt = Date.now();
    return key;
  }

  agentByKey(key) {
    if (!key) return null;
    const h = hashKey(key);
    return this.state.agents.find((a) => a.keyHash && crypto.timingSafeEqual(Buffer.from(a.keyHash), Buffer.from(h))) || null;
  }

  createAgent({ name, domain, persona, retentionDays, kind = 'native', permissions = {}, description }) {
    name = String(name || '').trim();
    if (!name || !DOMAINS[domain]) throw err(`name and a valid domain are required (${Object.keys(DOMAINS).join('|')})`, 400);
    if (!['native', 'external'].includes(kind)) throw err('kind must be native or external', 400);
    const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
    let id = base;
    for (let i = 2; this.state.agents.some((a) => a.id === id); i++) id = `${base}-${i}`;
    const agent = {
      id,
      name,
      domain,
      kind,
      persona: persona || '',
      description: description || '',
      permissions: { ...DEFAULT_PERMISSIONS, ...pickPermissions(permissions) },
      createdAt: Date.now(),
      builtin: false,
    };
    if (retentionDays !== undefined && retentionDays !== null && retentionDays !== '') agent.retentionDays = Number(retentionDays);
    const apiKey = this.issueKey(agent);
    this.state.agents.push(agent);
    this.store.save();
    this.bus.publish('agent-created', { id, name, domain, kind });
    audit(this, { op: 'agent-created', agentId: id, kind });
    return { agent: publicAgent(agent), apiKey };
  }

  updateAgent(id, patch = {}) {
    const a = this.getAgent(id);
    if (patch.name !== undefined && String(patch.name).trim()) a.name = String(patch.name).trim();
    if (patch.persona !== undefined) a.persona = patch.persona;
    if (patch.description !== undefined) a.description = patch.description;
    if (patch.permissions) a.permissions = { ...a.permissions, ...pickPermissions(patch.permissions) };
    if (patch.retentionDays !== undefined) {
      if (patch.retentionDays === null || patch.retentionDays === '') delete a.retentionDays;
      else a.retentionDays = Number(patch.retentionDays);
    }
    this.store.save();
    audit(this, { op: 'agent-updated', agentId: id, permissions: a.permissions });
    return publicAgent(a);
  }

  rotateKey(id) {
    const a = this.getAgent(id);
    const apiKey = this.issueKey(a);
    this.store.save();
    audit(this, { op: 'key-rotated', agentId: id });
    return { agent: publicAgent(a), apiKey };
  }

  deleteAgent(id) {
    const i = this.state.agents.findIndex((a) => a.id === id);
    if (i < 0) throw err('agent not found', 404);
    if (this.state.agents[i].builtin) throw err('built-in agents cannot be deleted', 400);
    this.state.agents.splice(i, 1);
    this.store.save();
    audit(this, { op: 'agent-deleted', agentId: id });
  }

  // ---------------- Customers ----------------
  createCustomer({ id, name }) {
    name = String(name || '').trim();
    id = String(id || '').trim() || `kh-${(Object.keys(this.state.customers).length + 1).toString().padStart(3, '0')}`;
    if (!/^[\w.-]{1,64}$/.test(id)) throw err('invalid customer id', 400);
    if (this.state.customers[id]) throw err('customer already exists', 409);
    this.state.customers[id] = { id, name: name || id, vip: false, createdAt: Date.now() };
    this.store.save();
    return this.state.customers[id];
  }

  setVip(customerId, vip) {
    const c = (this.state.customers[customerId] ||= { id: customerId, name: customerId });
    c.vip = !!vip;
    this.store.save();
    return c;
  }

  // ---------------- Memory admin ----------------
  resolveConflict(factId) {
    const f = resolveConflict(this, factId);
    if (!f) throw err('fact not found', 404);
    this.store.save();
    return f;
  }

  pinFact(factId, pinned = true) {
    const f = this.state.facts.find((x) => x.id === factId);
    if (!f) throw err('fact not found', 404);
    f.pinned = pinned;
    this.store.save();
    return f;
  }

  rollbackSkill(id) {
    const s = rollbackSkill(this, id);
    if (!s) throw err('cannot roll back', 400);
    this.store.save();
    return s;
  }

  pruneTraces() {
    const ids = Object.keys(this.state.traces);
    if (ids.length > 300) for (const id of ids.slice(0, ids.length - 300)) delete this.state.traces[id];
  }

  // What a given agent may see about a customer (GET /v1/profile).
  profile(agent, customerId, lang) {
    lang = normLang(lang);
    const now = this.clock.now();
    return this.state.facts
      .filter((f) => (f.customerId === customerId || f.customerId === '*') && f.status !== 'superseded' && (!f.validUntil || f.validUntil > now || f.pinned))
      .filter((f) => visibleTo(f, agent))
      .map((f) => ({ relation: f.relation, value: factValue(f, lang), text: factToText(f, lang), scope: f.scope, status: f.status, from: f.sourceAgentId }));
  }

  // ---------------- Company value report ----------------
  valueReport(lang = 'vi') {
    lang = normLang(lang);
    const s = this.state.stats || { totals: {}, byAgent: {}, daily: {} };
    const agents = this.state.agents;
    const ids = new Set(agents.map((a) => a.id));
    const agg = this.store.auditAggregates([...ids]);
    // read counts per (writer → reader); "cross" = written by another known agent
    const pair = (w, r) => agg.pairs.filter((p) => p.source === w && p.reader === r).reduce((n, p) => n + p.n, 0);
    const isCross = (p) => p.source && p.source !== p.reader && ids.has(p.source);
    const sum = (pred) => agg.pairs.filter(pred).reduce((n, p) => n + p.n, 0);
    const matrix = agents.map((w) => agents.map((r) => pair(w.id, r.id)));
    const perAgent = agents.map((a) => ({
      id: a.id,
      name: a.name,
      domain: a.domain,
      kind: a.kind,
      turns: s.byAgent[a.id]?.turns || 0,
      factsOwned: this.state.facts.filter((f) => f.sourceAgentId === a.id && f.status !== 'superseded').length,
      reads: sum((p) => p.reader === a.id),
      reusedByOthers: sum((p) => isCross(p) && p.source === a.id),
      usedFromOthers: sum((p) => isCross(p) && p.reader === a.id),
      accepted: s.byAgent[a.id]?.accepted || 0,
      declined: s.byAgent[a.id]?.declined || 0,
    }));
    const accepted = s.totals.accepted || 0;
    const declined = s.totals.declined || 0;
    // Always show a 7-day window ending today (brain clock), zero-filled.
    const today = this.clock.now();
    const days = Array.from({ length: 7 }, (_, i) => dayOf(today - (6 - i) * 86400000));
    const SECONDS_PER_QUESTION = 20; // assumption shown in the UI
    return {
      lang,
      generatedAt: this.clock.now(),
      kpis: {
        agents: agents.length,
        connectedAgents: agents.filter((a) => a.kind === 'external').length,
        customers: Object.keys(this.state.customers).length,
        turns: s.totals.turns || 0,
        apiCalls: (s.totals.recalls || 0) + (s.totals.remembers || 0),
        facts: this.state.facts.filter((f) => f.customerId !== '*' && f.status !== 'superseded').length,
        episodes: this.state.episodes.length,
        crossAgentReuse: sum(isCross),
        questionsSaved: agg.crossSemanticDistinct,
        minutesSaved: Math.round((agg.crossSemanticDistinct * SECONDS_PER_QUESTION) / 60),
        secondsPerQuestion: SECONDS_PER_QUESTION,
        handoffs: s.totals.handoffs || 0,
        suggestions: s.totals.suggestions || 0,
        accepted,
        declined,
        acceptanceRate: accepted + declined ? +(accepted / (accepted + declined)).toFixed(2) : null,
        skillsLearned: this.state.skills.filter((k) => k.origin === 'promoted').length,
        playbookRuns: s.totals.playbookRuns || 0,
        leaksBlocked: agg.blocked,
        insights: this.state.insights.length,
        auditEvents: agg.total,
      },
      flow: { agents: agents.map((a) => ({ id: a.id, name: a.name, domain: a.domain })), matrix },
      perAgent,
      daily: days.map((d) => ({ day: d, turns: s.daily[d]?.turns || 0, apiCalls: (s.daily[d]?.recalls || 0) + (s.daily[d]?.remembers || 0), handoffs: s.daily[d]?.handoffs || 0 })),
      insights: this.state.insights.slice(-8).reverse().map((i) => ({ ...i, customer: this.state.customers[i.customerId]?.name || i.customerId })),
    };
  }

  auditLog(limit = 100) {
    return this.store.recentAudit(limit).map((e) => ({ ...e, agentName: e.agentId ? this.agentName(e.agentId) : null, sourceName: e.sourceAgentId ? this.agentName(e.sourceAgentId) : null }));
  }

  // Everything the visualizer needs to render the memory panels, localized.
  snapshot(customerId = 'kh-001', lang = 'vi') {
    lang = normLang(lang);
    const now = this.clock.now();
    const strip = ({ embedding, ...rest }) => rest;
    const eps = this.state.episodes.filter((e) => e.customerId === customerId);
    const recent = new Set([...eps].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3).map((e) => e.id));
    const tier = (e) => (recent.has(e.id) ? 'hot' : (now - e.createdAt) / 86400000 <= 30 ? 'warm' : 'cold');
    const wm = this.state.working[customerId];
    return {
      now,
      lang,
      adminProtected: !!process.env.BRAIN_ADMIN_TOKEN,
      llm: { available: this.llm.available, provider: this.llm.provider, model: this.llm.model, label: this.llm.label, lastError: this.llm.lastError },
      domains: Object.fromEntries(Object.entries(DOMAINS).map(([k, d]) => [k, { label: tr(d.label, lang), color: d.color, retentionDays: d.retentionDays, primaryLayers: d.primaryLayers, episodeScope: d.episodeScope }])),
      agents: this.state.agents.map((a) => ({ ...publicAgent(a), persona: tr(a.persona, lang), stats: this.state.stats?.byAgent?.[a.id] || {} })),
      customers: Object.values(this.state.customers),
      working: wm
        ? { ...wm, activeTaskName: taskName(wm.activeTask, lang), outcomes: wm.outcomes.map((o) => ({ ...o, label: actionLabel(o.actionId, lang) })) }
        : null,
      episodes: eps.map((e) => ({ ...strip(e), tier: tier(e) })).sort((a, b) => b.createdAt - a.createdAt),
      facts: this.state.facts
        .filter((f) => f.customerId === customerId || f.customerId === '*')
        .map((f) => ({ ...strip(f), text: factToText(f, lang), displayValue: factValue(f, lang), stale: !!(f.validUntil && f.validUntil < now && !f.pinned) })),
      skills: this.state.skills.map((s) => ({ ...s, name: skillName(s, lang), stepLabels: s.steps.map((x) => labelOf(x, lang)) })),
      patterns: Object.values(this.state.patterns),
      bandit: Object.entries(this.state.bandit).map(([k, v]) => ({ key: k, label: actionLabel(k.split('|')[0], lang), ...v })),
      insights: this.state.insights.filter((i) => i.customerId === customerId),
      busLog: this.bus.log.slice(-30),
    };
  }
}

function pickPermissions(p) {
  const out = {};
  if (p.readShared !== undefined) out.readShared = p.readShared === true || p.readShared === 'true' || p.readShared === 'on';
  if (p.write !== undefined) out.write = p.write === true || p.write === 'true' || p.write === 'on';
  return out;
}

// Never expose the key hash.
export function publicAgent(a) {
  const { keyHash, ...rest } = a;
  return rest;
}

function visibleTo(f, agent) {
  if (f.scope === 'global') return true;
  if (f.scope === 'shared') return agent.permissions?.readShared !== false || f.sourceAgentId === agent.id;
  return f.ownerDomain === agent.domain;
}
