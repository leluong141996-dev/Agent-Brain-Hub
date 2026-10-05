# Contributing to Agent Brain Hub

Thanks for helping! Issues, docs fixes, translations and code are all welcome.

## Where to start

- Issues labelled [`good first issue`](https://github.com/leluong141996-dev/Agent-Brain-Hub/labels/good%20first%20issue) are small and come with pointers to the files involved.
- Questions, ideas and "show what you built" go to [Discussions](https://github.com/leluong141996-dev/Agent-Brain-Hub/discussions).
- Before starting something large, open an issue or discussion so we can agree on the approach.

## Development setup

Requires Node.js ≥ 18.18.

```bash
npm install
npm run dev        # server with auto-reload → http://localhost:4317
npm test           # 32 unit tests, no network or LLM needed
npm run e2e -- --lang en   # end-to-end test against the running server
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
| `sdk/`, `mcp/`, `examples/` | Client SDK, MCP server, sample connected agent |
| `test/` | `node:test` suites |

## Pull requests

1. Fork, create a branch, keep the change focused.
2. Add or update tests in `test/` when you change behaviour. `npm test` must pass.
3. User-facing text needs all three languages. Server side uses `L(lang, vi, en, ja)`; UI side uses `public/i18n.js`. If you don't speak one of them, write your best attempt and say so in the PR, and a maintainer will fix it.
4. Match the surrounding style: ES modules, no new runtime dependencies without discussion, no build step for the UI.
5. Never commit `data/` (it holds the memory database and API keys).

## Reporting security issues

Please don't open a public issue for vulnerabilities (for example a way to read another agent's private memory or an API key). Use GitHub's **Report a vulnerability** button on the Security tab instead.
