# Contributing to Agent Brain Hub

Thanks for helping! Issues, docs fixes, translations and code are all welcome.

## Where to start

- Issues labelled [`good first issue`](https://github.com/leluong141996-dev/Agent-Brain-Hub/labels/good%20first%20issue) are small and come with pointers to the files involved.
- Questions, ideas and "show what you built" go to [Discussions](https://github.com/leluong141996-dev/Agent-Brain-Hub/discussions).
- [ROADMAP.md](ROADMAP.md) shows where the project is heading. Benchmark scenarios from real multi-agent systems are especially welcome.
- Before starting something large, open an issue or discussion so we can agree on the approach.

## Development setup

Requires Node.js ≥ 22 (or just use Docker).

```bash
npm install
npm run dev        # server with auto-reload → http://localhost:4317
npm test           # unit tests, no network or LLM needed
npm run e2e -- --lang en   # end-to-end test against the running server
npm run bench              # memory benchmark (see bench/README.md)
```

Or with Docker: `docker compose up --build`.

No LLM is needed for development: the hub runs offline with rules and templates. Tests never call a real provider.

## Project map

| Path | What lives there |
|---|---|
| `server/brain/` | One file per brain region, plus `index.js` which orchestrates think / recall / remember / sleep |
| `server/brain/ontology.js` | Relations and rule-based fact extraction (vi / en / ja) |
| `server/store.js` | SQLite storage |
| `server/llm.js` | LLM provider registry and adapters |
| `server/index.js` | HTTP server: admin API `/api`, Brain API `/v1`, SSE, static UI |
| `public/` | Vanilla JS UI (no build step); `i18n.js` holds UI strings |
| `sdk/`, `mcp/` | JS and Python clients (no dependencies), MCP server over stdio |
| `examples/` | A software team on one brain (Python), a LangGraph graph, a connected JS agent |
| `bench/` | The memory benchmark: scenarios as JSON, runner, report, baselines per version |
| `docs/` | Features, connecting agents, architecture, configuration |
| `test/` | `node:test` suites |

## What the tests cover

- `npm test`: 194 unit tests, covering:
  - the acceptance QA suite from the architecture document: amnesia, contradiction, staleness, skill promotion, 20k-episode load;
  - permissions and prompt leakage;
  - English and Japanese;
  - connected agents (recall/remember), governance, key rotation, the value report;
  - the LLM layer: provider catalog, adapting to a strict mock OpenAI-style server, storing and masking keys, fetching model lists;
  - SQLite storage: data survives a reopen (embeddings included), only changed rows are written, the audit log is never truncated and SQL metrics match the in-memory computation, legacy JSON import, reset;
  - the automatic sleep cycle (idle, pressure, nightly), fact provenance in prompts, embedding providers (with a mock server), and the benchmark harness itself;
  - memory over time (`asOf`, history) and the entity graph: entity resolution, multi-hop retrieval that never reaches a private or expired fact, the graph API;
  - open schema and write policies: the relation registry (names, secrets, limits, persistence), provisional relations staying private per domain, promote / merge / delete, each policy, undo, trust, the review queue;
  - customer data (export and erase, persistence), the Python and JS clients against a running hub, PII formats and what must not be redacted;
  - self-maintaining memory: correct and forget (permissions, nothing left behind, same answer for hidden and missing facts, company-wide policies out of reach), consolidation from whole sessions, LLM conflict proposals and their lifecycle (REST, SDK and MCP included).
- `npm run bench`: the memory benchmark. 63 multi-agent scenarios (cross-agent recall, stale facts, contradictions, leakage, multi-hop, long conversations, exact matches, looking back in time, open schema, arbitration, maintenance) scored offline in under a second. Also `npm run bench:longmemeval` (public dataset, retrieval) and `npm run bench:scale` (latency with a large memory). See [bench/README.md](bench/README.md); adding a scenario is one JSON file.
- `npm run e2e -- --lang vi|en|ja`: 11 steps against a running server, with any LLM configuration (offline, Claude, GPT, local models…). Includes a connected agent through the SDK and the MCP server over stdio. The test uses a new customer so existing data is left alone, but it advances the simulated clock by 7 days.

## Pull requests

1. Fork, create a branch, keep the change focused.
2. Add or update tests in `test/` when you change behaviour. `npm test` must pass, and so must the benchmark gate (`npm run bench -- --gate bench/results/0.8.4.json`). If your change is meant to move a benchmark number, re-save the baseline and explain it in the PR.
3. User-facing text needs all three languages. Server side uses `L(lang, vi, en, ja)`; UI side uses `public/i18n.js`. If you don't speak one of them, write your best attempt and say so in the PR, and a maintainer will fix it.
4. Match the surrounding style: ES modules, no new runtime dependencies without discussion, no build step for the UI.
5. Never commit `data/` (it holds the memory database and API keys).

## Reporting security issues

Please don't open a public issue for vulnerabilities (for example a way to read another agent's private memory or an API key). See [SECURITY.md](SECURITY.md) for how to report them privately.

## Code of conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
