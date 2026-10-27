// Configurable domains (v0.9). A domain is an agent specialty: the intents its
// agents recognise, how long their memories live, whether their sessions are
// private, and which relations an intent needs. Seven are built in; an admin
// adds more over the API (kept in the brain's state) or in a JSON file named by
// BRAIN_DOMAINS (configuration as code, read-only over the API).
//
// DOMAINS in agents.js is the live registry every module reads. There is one
// brain per process, so loadDomains() resets it to the built-ins plus this
// brain's domains whenever a brain starts.
import fs from 'node:fs';
import { DOMAINS, BUILTIN_DOMAINS, SHARED_INTENTS } from '../agents.js';
import { normalizeName } from './registry.js';
import { tr } from '../i18n.js';

const ID = /^[a-z][a-z0-9_]{1,31}$/;
const INTENT = /^[a-z][a-z0-9_]{0,39}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_INTENTS = 20;
const MAX_KEYWORDS = 60;

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

function builtinIntents() {
  const out = new Map();
  for (const [d, def] of Object.entries(BUILTIN_DOMAINS)) for (const i of Object.keys(def.intents)) out.set(i, d);
  for (const i of Object.keys(SHARED_INTENTS)) out.set(i, 'shared');
  return out;
}

function label(value) {
  if (typeof value === 'string' && value.trim()) {
    const v = value.trim().slice(0, 60);
    return { vi: v, en: v, ja: v };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const l of ['vi', 'en', 'ja']) if (typeof value[l] === 'string' && value[l].trim()) out[l] = value[l].trim().slice(0, 60);
    const any = out.en || out.vi || out.ja;
    if (any) return { vi: out.vi || out.en || any, en: out.en || out.vi || any, ja: out.ja || out.en || any };
  }
  throw bad('label is required: a string, or { en, vi, ja }');
}

// A checked, normalised domain definition (throws 400 with the reason).
export function validateDomain(id, body = {}) {
  if (!ID.test(String(id))) throw bad('domain id must be 2-32 characters: a-z, 0-9, _ (starting with a letter)');
  const def = {
    label: label(body.label),
    color: body.color === undefined ? '#64748b' : COLOR.test(body.color) ? body.color : (() => { throw bad('color must look like #14b8a6'); })(),
    retentionDays: body.retentionDays === undefined || body.retentionDays === null ? null : Number(body.retentionDays),
    primaryLayers: ['semantic', 'episodic'],
    episodeScope: body.episodeScope === undefined ? 'shared' : body.episodeScope,
    intents: {},
    intentRelations: {},
  };
  if (def.retentionDays !== null && !(Number.isInteger(def.retentionDays) && def.retentionDays >= 1 && def.retentionDays <= 36500)) throw bad('retentionDays must be a whole number of days (1-36500), or null to keep forever');
  if (!['shared', 'private'].includes(def.episodeScope)) throw bad('episodeScope must be "shared" or "private"');
  const intents = body.intents === undefined ? {} : body.intents;
  if (!intents || typeof intents !== 'object' || Array.isArray(intents)) throw bad('intents must be an object: { intent_name: [keywords] }');
  const taken = builtinIntents();
  const names = Object.keys(intents);
  if (names.length > MAX_INTENTS) throw bad(`at most ${MAX_INTENTS} intents per domain`);
  for (const name of names) {
    if (!INTENT.test(name)) throw bad(`intent "${name}": use a-z, 0-9, _ (starting with a letter)`);
    if (taken.has(name)) throw bad(`intent "${name}" already exists (${taken.get(name)}); pick another name`);
    const kws = intents[name];
    if (!Array.isArray(kws) || !kws.length || kws.length > MAX_KEYWORDS || !kws.every((k) => typeof k === 'string' && k.trim() && k.length <= 60)) {
      throw bad(`intents.${name} must be a list of 1-${MAX_KEYWORDS} keywords (each up to 60 characters)`);
    }
    def.intents[name] = kws.map((k) => k.trim());
  }
  const rels = body.intentRelations === undefined ? {} : body.intentRelations;
  if (!rels || typeof rels !== 'object' || Array.isArray(rels)) throw bad('intentRelations must be an object: { intent_name: [relations] }');
  for (const [intent, list] of Object.entries(rels)) {
    if (!def.intents[intent]) throw bad(`intentRelations.${intent}: no such intent in this domain`);
    if (!Array.isArray(list) || list.length > 20 || !list.every((r) => typeof r === 'string' && normalizeName(r))) throw bad(`intentRelations.${intent} must be a list of relation names`);
    def.intentRelations[intent] = list.map((r) => normalizeName(r));
  }
  return def;
}

function fileDomains() {
  const file = process.env.BRAIN_DOMAINS;
  if (!file) return {};
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`BRAIN_DOMAINS: cannot read ${file}: ${e.message}`);
  }
  const src = json.domains || json;
  const out = {};
  for (const [id, body] of Object.entries(src)) {
    if (BUILTIN_DOMAINS[id]) throw new Error(`BRAIN_DOMAINS: "${id}" is a built-in domain`);
    try {
      out[id] = validateDomain(id, body);
    } catch (e) {
      throw new Error(`BRAIN_DOMAINS: domain "${id}": ${e.message}`);
    }
  }
  return out;
}

// Reset the live registry to the built-ins plus this brain's domains.
export function loadDomains(B) {
  for (const id of Object.keys(DOMAINS)) if (!BUILTIN_DOMAINS[id]) delete DOMAINS[id];
  B.state.domains ||= {};
  for (const [id, def] of Object.entries(B.state.domains)) if (!BUILTIN_DOMAINS[id]) DOMAINS[id] = { ...def, source: 'api' };
  B._fileDomains = new Set();
  for (const [id, def] of Object.entries(fileDomains())) {
    DOMAINS[id] = { ...def, source: 'file' };
    B._fileDomains.add(id);
  }
}

function guard(B, id) {
  if (BUILTIN_DOMAINS[id]) throw bad(`"${id}" is a built-in domain and cannot be changed`, 409);
  if (B._fileDomains?.has(id)) throw bad(`"${id}" is defined in the BRAIN_DOMAINS file; change it there`, 409);
}

export function putDomain(B, id, body) {
  guard(B, id);
  const def = validateDomain(id, body);
  B.state.domains[id] = def;
  DOMAINS[id] = { ...def, source: 'api' };
  return view(id, DOMAINS[id], 'en');
}

export function deleteDomain(B, id) {
  guard(B, id);
  if (!DOMAINS[id]) throw bad(`domain "${id}" not found`, 404);
  const agents = B.state.agents.filter((a) => a.domain === id).map((a) => a.name);
  if (agents.length) throw bad(`domain "${id}" is in use by ${agents.join(', ')}; move or delete those agents first`, 409);
  const rels = Object.values(B.state.relations || {}).filter((r) => r.owner === id).map((r) => r.name);
  if (rels.length) throw bad(`domain "${id}" is in use: it owns ${rels.join(', ')}`, 409);
  delete B.state.domains[id];
  delete DOMAINS[id];
  return { deleted: id };
}

function view(id, d, lang) {
  return {
    id,
    label: tr(d.label, lang),
    color: d.color,
    retentionDays: d.retentionDays ?? null,
    episodeScope: d.episodeScope,
    intents: d.intents,
    intentRelations: d.intentRelations || {},
    builtin: !!BUILTIN_DOMAINS[id],
    source: BUILTIN_DOMAINS[id] ? 'builtin' : d.source || 'api',
  };
}

export function listDomains(B, lang) {
  return Object.entries(DOMAINS).map(([id, d]) => ({ ...view(id, d, lang), agents: B.state.agents.filter((a) => a.domain === id).length }));
}

// Relations a custom intent needs (the built-in intents have their own table in ras.js).
export function intentRelationsOf(intent) {
  for (const d of Object.values(DOMAINS)) if (d.intentRelations?.[intent]) return d.intentRelations[intent];
  return null;
}
