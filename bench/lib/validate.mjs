// Scenario files: load and validate, with errors that name the file and step.
import fs from 'node:fs';
import path from 'node:path';

export const CATEGORIES = ['cross_agent', 'stale', 'contradiction', 'leakage', 'multi_hop', 'long_conversation', 'exact_match', 'temporal', 'open_schema', 'arbitration'];
const LANGS = ['vi', 'en', 'ja'];
const KINDS = ['say', 'recall', 'remember', 'advance', 'sleep', 'mark', 'promote'];
const RECALL_CHECKS = ['remembers', 'private', 'stale', 'conflict'];
const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(s) {
  const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(String(s));
  return m ? Number(m[1]) * UNITS[m[2]] : null;
}

function patternError(p) {
  if (typeof p !== 'string' || !p.trim()) return 'must be a non-empty string';
  const m = /^\/(.+)\/([a-z]*)$/s.exec(p);
  if (!m) return null;
  try {
    new RegExp(m[1], m[2]);
    return null;
  } catch (e) {
    return `is not a valid regex (${e.message})`;
  }
}

export function validateScenario(s, file, { agents }) {
  const errs = [];
  const err = (msg, step) => errs.push(`${file}: ${step ? `step ${step}: ` : ''}${msg}`);
  if (!s || typeof s !== 'object') return [`${file}: must be a JSON object`];
  if (typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) err('id must be kebab-case, e.g. "cross-agent-car"');
  if (!CATEGORIES.includes(s.category)) err(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!LANGS.includes(s.lang)) err(`lang must be one of ${LANGS.join(', ')}`);
  if (s.requires !== undefined && s.requires !== 'llm') err('requires must be "llm"');
  if (!Array.isArray(s.steps) || !s.steps.length) {
    err('steps must be a non-empty list');
    return errs;
  }
  const marks = new Set();
  s.steps.forEach((st, i) => {
    const n = i + 1;
    const kinds = KINDS.filter((k) => st && st[k] !== undefined);
    if (kinds.length !== 1) return err(`a step must have exactly one of ${KINDS.join(', ')}`, n);
    const kind = kinds[0];
    if (kind === 'say' || kind === 'recall') {
      if (!agents.includes(st.agent)) err(`unknown agent "${st.agent}" (known: ${agents.join(', ')})`, n);
      if (typeof st[kind] !== 'string' || !st[kind].trim()) err(`"${kind}" must be a non-empty string`, n);
      if (st.customer !== undefined && (typeof st.customer !== 'string' || !st.customer)) err('"customer" must be a non-empty string', n);
    }
    if (kind === 'remember') {
      if (!agents.includes(st.agent)) err(`unknown agent "${st.agent}" (known: ${agents.join(', ')})`, n);
      const facts = st.remember?.facts;
      if (!Array.isArray(facts) || !facts.length || facts.some((f) => !f || typeof f.relation !== 'string' || !f.relation || f.value === undefined)) err('remember.facts must be a non-empty list of {relation, value}', n);
    }
    if (kind === 'promote') {
      if (typeof st.promote?.relation !== 'string' || !st.promote.relation) err('promote.relation must be a relation name', n);
      if (st.promote?.scope !== undefined && !['private', 'shared'].includes(st.promote.scope)) err('promote.scope must be private or shared', n);
    }
    if (kind === 'advance' && parseDuration(st.advance) === null) err('"advance" must look like "45m", "6h" or "2d"', n);
    if (kind === 'sleep' && st.sleep !== true) err('"sleep" must be true', n);
    if (kind === 'mark') {
      if (typeof st.mark !== 'string' || !st.mark.trim()) err('"mark" must be a non-empty name', n);
      else if (marks.has(st.mark)) err(`mark "${st.mark}" is already used`, n);
      else marks.add(st.mark);
    }
    if (st.asOf !== undefined) {
      if (kind !== 'recall') err('"asOf" is only allowed on recall steps', n);
      else if (!marks.has(st.asOf)) err(`asOf "${st.asOf}" must refer to an earlier mark`, n);
    }
    if (st.expect === undefined) return;
    if (typeof st.expect !== 'object' || Array.isArray(st.expect)) return err('expect must be an object', n);
    for (const [k, v] of Object.entries(st.expect)) {
      if (RECALL_CHECKS.includes(k)) {
        if (kind !== 'recall') { err(`"${k}" is only allowed on recall steps`, n); continue; }
        if (!Array.isArray(v) || !v.length) { err(`expect.${k} must be a list of texts`, n); continue; }
        v.forEach((p) => { const e = patternError(p); if (e) err(`expect.${k}: ${JSON.stringify(p)} ${e}`, n); });
      } else if (k === 'reply') {
        if (kind !== 'say') { err('"reply" is only allowed on say steps', n); continue; }
        const lists = ['includes', 'excludes'].filter((x) => v?.[x] !== undefined);
        if (!lists.length) err('expect.reply needs "includes" and/or "excludes"', n);
        for (const x of lists) {
          if (!Array.isArray(v[x])) err(`expect.reply.${x} must be a list of texts`, n);
          else v[x].forEach((p) => { const e = patternError(p); if (e) err(`expect.reply.${x}: ${JSON.stringify(p)} ${e}`, n); });
        }
      } else err(`unknown check "${k}" (use ${[...RECALL_CHECKS, 'reply'].join(', ')})`, n);
    }
  });
  return errs;
}

export function loadScenarios(dir, { agents }) {
  const scenarios = [];
  const errors = [];
  const ids = new Map();
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    let s;
    try {
      s = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      errors.push(`${name}: invalid JSON (${e.message})`);
      continue;
    }
    const errs = validateScenario(s, name, { agents });
    if (ids.has(s?.id)) errs.push(`${name}: id "${s.id}" is already used by ${ids.get(s.id)}`);
    if (errs.length) errors.push(...errs);
    else {
      ids.set(s.id, name);
      scenarios.push({ ...s, file: name });
    }
  }
  return { scenarios, errors };
}
