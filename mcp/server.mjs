#!/usr/bin/env node
// Agent Brain Hub — MCP server (stdio, JSON-RPC 2.0, zero dependencies).
// Lets any MCP-capable agent (Claude Desktop/Code, Cursor, agent frameworks…)
// use the shared brain as tools. Each MCP server instance acts as ONE
// connected agent, identified by its API key.
//
//   BRAIN_URL=http://localhost:4317 BRAIN_API_KEY=abk_... node mcp/server.mjs
import readline from 'node:readline';
import fs from 'node:fs';
import { BrainClient } from '../sdk/brain-client.js';

const brain = new BrainClient({ url: process.env.BRAIN_URL || 'http://localhost:4317', apiKey: process.env.BRAIN_API_KEY || 'missing' });
const DEFAULT_LANG = process.env.BRAIN_LANG || 'en';
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const log = (...a) => process.stderr.write(`[agent-brain-mcp] ${a.join(' ')}\n`);

const lang = { type: 'string', enum: ['vi', 'en', 'ja'], description: 'Reply / label language' };
const TOOLS = [
  {
    name: 'brain_recall',
    description:
      'Retrieve what the shared company brain knows that is relevant to the customer\'s message: facts and past episodes written by any agent (filtered by permissions), emotional priority, handoff context, a learned playbook and suggested next actions. Call this BEFORE answering a customer. Use the returned promptBlock as context and keep the traceId for brain_remember.',
    inputSchema: { type: 'object', properties: { customerId: { type: 'string', description: 'Stable customer id, e.g. kh-001' }, text: { type: 'string', description: "The customer's latest message" }, lang }, required: ['customerId', 'text'] },
  },
  {
    name: 'brain_remember',
    description:
      'Store the turn in the shared brain after you answered, so every other agent benefits. Pass the traceId from brain_recall and your reply. Optionally add explicit facts [{relation, value}]: use a built-in relation when one fits (name, lives_in, occupation, has_children, prefers, dislikes, diet, owns_asset, trip_destination, allergic_to, budget, income…) or a short snake_case name for anything else (e.g. loyalty_tier); new relations stay private to your domain until an admin promotes them. Never store secrets. Optionally add the outcome of a suggested action.',
    inputSchema: {
      type: 'object',
      properties: {
        traceId: { type: 'string' },
        customerId: { type: 'string' },
        userText: { type: 'string', description: 'Only if you did not call brain_recall first' },
        reply: { type: 'string', description: 'What you answered' },
        facts: { type: 'array', items: { type: 'object', properties: { relation: { type: 'string' }, value: { type: 'string' } }, required: ['relation', 'value'] } },
        outcome: { type: 'object', properties: { actionId: { type: 'string' }, accepted: { type: 'boolean' } } },
        lang,
      },
    },
  },
  {
    name: 'brain_correct',
    description:
      'Correct a fact in the shared brain that is wrong (the customer says so, or you verified it). The wrong value is kept as history and, if you pass value, replaced by it. Use wrongValue to pick one value of a multi-valued relation (e.g. one of several likes). You can only correct facts you are allowed to see.',
    inputSchema: { type: 'object', properties: { customerId: { type: 'string' }, relation: { type: 'string', description: 'e.g. lives_in' }, wrongValue: { type: 'string' }, value: { type: 'string', description: 'The correct value (omit to just drop the wrong one)' }, reason: { type: 'string' }, lang }, required: ['customerId', 'relation'] },
  },
  {
    name: 'brain_forget',
    description:
      'Forget something because the customer asked you to: deletes the facts of that relation you are allowed to see (or only value), including their history, and removes the value from the conversations you can see. Use it only on an explicit request. Mentions of the value are removed word for word; a summary an LLM wrote in other words may still describe it. It cannot erase other domains\' private data or company-wide policies; a full erase of a customer is an admin action.',
    inputSchema: { type: 'object', properties: { customerId: { type: 'string' }, relation: { type: 'string' }, value: { type: 'string', description: 'Only this value (omit to forget every value of the relation)' } }, required: ['customerId', 'relation'] },
  },
  {
    name: 'brain_profile',
    description: 'List the facts about a customer that this agent is allowed to see in the shared brain.',
    inputSchema: { type: 'object', properties: { customerId: { type: 'string' }, lang }, required: ['customerId'] },
  },
  {
    name: 'brain_feedback',
    description: 'Report whether the customer accepted a suggested action (from brain_recall). The brain learns which actions work.',
    inputSchema: { type: 'object', properties: { traceId: { type: 'string' }, actionId: { type: 'string' }, accepted: { type: 'boolean' }, lang }, required: ['traceId', 'actionId', 'accepted'] },
  },
];

async function callTool(name, args = {}) {
  const l = args.lang || DEFAULT_LANG;
  switch (name) {
    case 'brain_recall': {
      const r = await brain.recall({ customerId: args.customerId, text: args.text, lang: l });
      const actions = r.suggestedActions.map((a) => `- ${a.id}: ${a.label}`).join('\n') || '- (none)';
      return `traceId: ${r.traceId}\nintent: ${r.intent.intent} · priority: ${r.salience.priority}${r.crisis ? ' · CRISIS — escalate to a human now' : ''}\n\n${r.promptBlock}\n\n## Suggested action ids (for brain_feedback)\n${actions}`;
    }
    case 'brain_remember': {
      const r = await brain.remember({ ...args, lang: l });
      return `stored. learned: ${r.learned.map((x) => `${x.text} (${x.action})`).join('; ') || 'nothing new'}${r.feedback?.promoted ? `\nnew skill learned: ${r.feedback.promoted.name}` : ''}`;
    }
    case 'brain_correct': {
      const r = await brain.correct({ customerId: args.customerId, relation: args.relation, wrongValue: args.wrongValue, value: args.value, reason: args.reason, lang: l });
      return `corrected: ${r.corrected.join('; ')}${r.fact ? `\nnow: ${r.fact}` : ''}`;
    }
    case 'brain_forget': {
      const r = await brain.forget({ customerId: args.customerId, relation: args.relation, value: args.value });
      return r.removedFacts ? `forgotten: ${r.removedFacts} fact(s), value removed from ${r.scrubbed} text(s)` : 'nothing you can see matched';
    }
    case 'brain_profile': {
      const r = await brain.profile({ customerId: args.customerId, lang: l });
      return r.facts.length ? r.facts.map((f) => `- ${f.text} [${f.scope}${f.status === 'conflicted' ? ', CONFLICT' : ''}]`).join('\n') : 'no visible facts';
    }
    case 'brain_feedback': {
      const r = await brain.feedback({ traceId: args.traceId, actionId: args.actionId, accepted: args.accepted, lang: l });
      return r.duplicate ? 'already recorded' : `recorded${r.promoted ? ` — new skill learned: ${r.promoted.name}` : ''}`;
    }
    default:
      throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
  }
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-brain-hub', version: VERSION },
          instructions: 'Shared company brain. Call brain_recall before answering a customer and brain_remember after answering.',
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS });
      case 'tools/call':
        try {
          const text = await callTool(params.name, params.arguments);
          return reply(id, { content: [{ type: 'text', text }] });
        } catch (e) {
          if (e.code === -32602) return fail(id, -32602, e.message);
          return reply(id, { content: [{ type: 'text', text: `Brain error: ${e.message}` }], isError: true });
        }
      default:
        if (isRequest) return fail(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    log('error', e.message);
    if (isRequest) fail(id, -32603, e.message);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, 'parse error');
  }
  handle(msg);
});
log(`ready · ${process.env.BRAIN_URL || 'http://localhost:4317'}`);
