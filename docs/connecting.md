[← README](../README.md)

# Connecting agents and the Brain API

## Three ways to connect an agent

### 1. Native: create it in the UI
Go to **Agents → Create agent → Native**, pick a domain and a persona. The brain answers with the hub's LLM, and you can chat with the agent right away on the Live brain screen.

### 2. Connected via REST API / SDK
Create an agent of type **Connected**. It gets an API key, shown only once and stored as a hash. Your agent keeps using its own LLM, in this loop:

```
recall (get context) → your agent answers with its own LLM using promptBlock → remember (send the turn back so the brain learns)
```

```js
import { BrainClient } from './sdk/brain-client.js';
const brain = new BrainClient({ url: 'http://localhost:4317', apiKey: process.env.BRAIN_API_KEY });

const ctx = await brain.recall({ customerId: 'kh-001', text: userMessage, lang: 'en' });
const reply = await myLLM({ system: ctx.promptBlock, user: ctx.redactedText });
await brain.remember({ traceId: ctx.traceId, reply });
```

The same loop in Python ([sdk/brain_client.py](../sdk/brain_client.py), standard library only, Python 3.8+), with `correct()` and `forget()` as well:

```python
from brain_client import BrainClient
brain = BrainClient(url="http://localhost:4317", api_key=os.environ["BRAIN_API_KEY"])

ctx = brain.recall(customer_id="kh-001", text=user_message, lang="en")
reply = my_llm(system=ctx["promptBlock"], user=ctx["redactedText"])
brain.remember(trace_id=ctx["traceId"], reply=reply)
```

A sample agent you can run right away (open the UI next to it to watch the brain light up and the conversation appear in the chat):

```bash
BRAIN_API_KEY=abk_... npm run example
# optional: OWN_LLM_URL=http://localhost:8000/v1 OWN_LLM_MODEL=qwen3-4b BRAIN_LANG=en
```

### 3. MCP: for Claude Desktop/Code, Cursor and agent frameworks
[mcp/server.mjs](../mcp/server.mjs) is a dependency-free MCP server over stdio. Each instance acts as one connected agent and exposes 6 tools: `brain_recall`, `brain_remember`, `brain_correct`, `brain_forget`, `brain_profile`, `brain_feedback`.

```bash
claude mcp add agent-brain -e BRAIN_URL=http://localhost:4317 -e BRAIN_API_KEY=abk_... -- node /path/to/repo/mcp/server.mjs
```

The Agents screen generates the `mcpServers` config for Claude Desktop and Cursor, with the path and key filled in.

## Brain API (`/v1`, header `Authorization: Bearer <agent key>`)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/v1/me` | | agent, domain, kind, permissions |
| POST | `/v1/recall` | `{customerId, text, lang, asOf?}` | `traceId, intent, salience, handoff, playbook, memories[]` (each with `from`, `updatedAt`, `validUntil`, and `via` when it came in through the entity graph), `suggestedActions[], promptBlock, redactedText` |
| POST | `/v1/remember` | `{traceId \| userText, reply, facts?: [{relation, value}], outcome?: {actionId, accepted}, lang}` (any relation name; a new one starts provisional) | `learned[]`, feedback |
| POST | `/v1/correct` | `{customerId, relation, wrongValue?, value?, reason?}` | the corrected facts and the new one; the wrong value is kept as history |
| POST | `/v1/forget` | `{customerId, relation, value?}` | `{removedFacts, scrubbed}`: the facts this agent can see are deleted, with their history |
| POST | `/v1/chat` | `{customerId, text, lang}` | the brain answers itself (native mode over the API) |
| POST | `/v1/feedback` | `{traceId, actionId, accepted}` | bandit update + skill promotion |
| GET | `/v1/profile` | `?customerId=&lang=` | the facts this agent is allowed to see |

`/v1` has CORS enabled, so agents running in a browser can call it too. The admin API `/api/*` (used by the UI) can be locked with `BRAIN_ADMIN_TOKEN`. `GET /healthz` needs no auth and is meant for Docker and load balancers.

More examples: [examples/dev_team.py](../examples/dev_team.py) (a software team on one brain), [examples/langgraph_memory.py](../examples/langgraph_memory.py) (LangGraph), [examples/connected-agent.mjs](../examples/connected-agent.mjs) (JS, with its own LLM).
