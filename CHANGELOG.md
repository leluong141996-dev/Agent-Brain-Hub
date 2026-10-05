# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Crash on Node 24 (`Assertion failed: (env) != nullptr` in `node::RemoveEnvironmentCleanupHook`): better-sqlite3 11 aborts the process when V8 garbage-collects a dropped prepared statement while the event loop is idle. This could take down the Docker image at random, for example after opening the value dashboard. Fixed by upgrading to better-sqlite3 13.
- Docker: setting `PORT` in `.env` made the hub unreachable (the container listened on that port while compose mapped it to 4317). `PORT` now only sets the port on your machine.
- CI: `npm test` failed on Node 22, which no longer expands a directory passed to `node --test`.

### Added

- Docker: LLM servers running on the host (Ollama, LM Studio, vLLM) are reachable at `http://host.docker.internal:<port>/v1`.
- `npm run e2e` accepts an admin token (`--token` or `BRAIN_ADMIN_TOKEN`).

### Changed

- Docker image based on Node 24 LTS (Node 20 reached end of life in April 2026), with an init process for clean signal handling.
- **Node.js 22 or newer is now required** (better-sqlite3 13 needs it; Node 18 and 20 are end-of-life). Docker users are not affected.
- CI tests Node 22 and 24.

## [0.1.0] - 2026-10-06

First public release.

### Added

- **Shared brain for many agents.** Native agents created in the UI and connected agents running elsewhere read and write one memory, with per-agent API keys (stored as SHA-256 hashes, rotatable).
- **13 brain-inspired regions** across a wake loop (`think` / `recall` / `remember`) and a sleep loop: thalamus, brainstem (PII redaction, crisis reflex), amygdala, prefrontal working memory, RAS retrieval (scope → TTL → hybrid scoring → re-rank → token budget), neocortex (facts + episodes, hot/warm/cold tiers, contradiction resolution), hippocampus, cerebellum (skills promoted after 3 successes in 7 days, versioned with rollback), basal ganglia (Thompson-sampling next-best-action), corpus callosum (handoff), forgetting, default mode network and audit.
- **Live brain view.** Every request, including ones from external agents over the API, is traced region by region over Server-Sent Events, with the memory items each answer was built from.
- **Three ways to connect an agent:** REST Brain API (`/v1`), a dependency-free JS SDK (`sdk/brain-client.js`) and an MCP server over stdio (`mcp/server.mjs`) for Claude Desktop/Code, Cursor and agent frameworks.
- **Governance:** private / shared / global memory scopes, per-agent read/write permissions, single writer per entity, and an append-only audit log of every read, write, block and API call.
- **Value dashboard:** questions customers did not have to answer again, cross-agent knowledge reuse, handoffs, suggestion acceptance, learned skills, blocked leaks and an agent-to-agent knowledge flow matrix.
- **LLM settings in the UI:** Claude, GPT, Gemini, DeepSeek, Mistral, Groq, Grok, OpenRouter, Together, Ollama, vLLM, LM Studio or any OpenAI-compatible endpoint; fetch model lists, test the connection and apply without a restart. API keys stay on the server and are only shown masked. Runs fully offline (rules + templates) with no configuration.
- **Trilingual:** Vietnamese, English and Japanese for the UI, fact extraction rules, traces and replies.
- **SQLite storage** (`better-sqlite3`, WAL): in-memory write-back cache with row-level diffs, Float32 embedding BLOBs, an append-only audit table and a one-time import of the legacy `brain.json`.
- **Docker:** `docker compose up` runs the hub with a persistent volume and a health check. An optional `vllm` profile serves Qwen3-4B locally on an NVIDIA GPU.
- `GET /healthz` endpoint (no auth) for Docker and load balancers.
- README in English (`README.md`) and Vietnamese (`README.vi.md`), `CONTRIBUTING.md`, issue and PR templates, and a CI workflow (tests on Node 18/20/22, Docker build, end-to-end run).
- 32 unit tests (including the acceptance QA suite: amnesia, contradiction, staleness, skill promotion, 20k-episode load) and an 11-step end-to-end script (`npm run e2e -- --lang vi|en|ja`).

[Unreleased]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/releases/tag/v0.1.0
