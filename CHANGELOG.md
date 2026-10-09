# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.0] - 2026-10-09

Memory that is **connected**: facts are grouped into entities, and retrieval follows the links between them.

### Added

- **Entity graph** (`server/brain/entities.js`). A customer's facts are grouped into entities: a car, laptop, phone or appliance (a vi / en / ja lexicon with brands and models, so "my car" = "xe" = "車" = "Honda Civic"), a trip ("Da Nang" = "Đà Nẵng"), and profile groups (health, finance, travel…). Resolution happens only within one customer; two customers are never merged.
- **Multi-hop retrieval.** RAS links the entities a question names ("my Civic", "the XPS", "Tokyo") and spreads relevance from the facts the question matched to connected ones: the same car or trip (weight 0.6), or a related kind of fact through an affinity table (trip ↔ car availability, diet, allergy, budget…; 0.5). At most 2 hops and 6 added facts. Only candidates that already passed the permission and time checks take part, so the graph cannot reach a private or expired fact. Profile groups are not hubs.
- **`via` explains each added fact:** in the prompt (`no car for 3 days (… via: Honda Civic)`), on `/v1/recall` memories, and in the live trace.
- **`GET /api/graph?customerId&asOf`** returns one customer's entities, facts and edges, at any time.
- **Graph tab** in the Live brain inspector: entities around the customer, facts around their entity, related-kind edges as dashed curves. Click a fact to see what it connects to and why; a link to a private fact is marked with the only domain that can follow it. Works with *View memory as of*.
- **Benchmark:** 8 new `multi_hop` scenarios (37 in total), and `npm run bench -- --no-graph` (`BRAIN_GRAPH=off`) to measure what the graph adds:

  | 0.6.0, hashing | With the graph | `--no-graph` |
  |---|---|---|
  | multi_hop (10 scenarios) | **100%** | 40% |
  | All 37 scenarios | **97.3%** | 81.1% |
  | Prompt tokens (mean) | 427 | 421 |

  Leak rate is 0% in both. With `bge-m3`, all 37 pass with or without the graph: the embedding model already links "the XPS" to "the laptop". Today the graph pays off in the default offline mode, and in explaining *why* a fact was retrieved.

### Fixed

- "I'm flying / travelling / heading to X" was not remembered as a trip, and "airport" questions were not recognised as ground transport.
- "The Camry broke down" was stored as "no device for 4 days": brands and models now name the asset.

### Not changed

- LongMemEval-S retrieval stays at 52.8% @4: it ranks whole sessions, which the fact graph does not touch.

## [0.5.0] - 2026-10-09

Memory that is **correct over time**: facts are invalidated instead of deleted, and you can ask what the brain believed at any moment.

### Added

- **`recall({ asOf })`** (REST: `asOf` on `/v1/recall`): what the brain believed at that time. It is read-only (no working-memory turn, no access counts), audited as `inspect`, and enforces the same permissions. Debug questions like "what did Atlas know when it booked the flight?".
- **Facts are invalidated, not deleted.** New fields: `recordedAt`, `validFrom`, `invalidatedAt` / `invalidatedBy` / `invalidReason` (`superseded` or `resolved`), `conflictedAt` / `conflictResolvedAt`. A replaced fact keeps its chain: `GET /api/facts/:id/history` shows Hanoi → Saigon with dates. Older data is converted on load; no migration step.
- **History retention:** sleep purges expired and replaced facts after **90 days** (Settings → Sleep cycle → *Keep fact history*, or `BRAIN_HISTORY_DAYS`; `0` restores immediate deletion).
- **UI:** a *View memory as of* bar on the Semantic and Episodic tabs, a clear banner while viewing the past, per-fact history, and translated status badges.
- **Benchmark:** a `mark` step and `asOf` on recall; new `temporal` category (4 scenarios). The suite now has 29 scenarios. With `bge-m3`, all 29 pass.

### Fixed

- **"I don't like X anymore" kept both "likes X" and "dislikes X anymore"** ([#22](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/22)). Trailing time words (anymore, now, last month, nữa, tháng trước…) are trimmed from values, so the update replaces the old preference. Stale-use rate: 25% → 0%.
- An expired fact counted as live when a new fact arrived, so "in the shop for 5 days" after an expired "3 days" became a false conflict.
- LongMemEval script: about 6% of LongMemEval-S sessions are dated after their question. The clock is now set past the last session, so those sessions stay "told" (the retrieval score is unchanged: 52.8% @4).

### Changed

- Expired facts are no longer deleted at the next sleep; retrieval still ignores them, and they are purged after the history period.

## [0.4.0] - 2026-10-09

Retrieval that scales, keeps exact matches with embeddings on, and a first number on a public dataset.

### Added

- **Hybrid retrieval** ([#13](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/13)). With an embedding model on, similarity is now model + lexical (CombSUM). Models blur exact tokens: among twelve order conversations, bge-m3 alone could not pick out "order 48207"; the lexical signal does. Hashing-only mode is unchanged.
- **Per-customer memory index** ([#13](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/13)). Retrieval reads one customer's memories instead of scanning everyone's (`npm run bench:scale`):

  | Recall latency (hashing) | 0.3.0 | 0.4.0 |
  |---|---|---|
  | 20,000 episodes | p50 1.48 ms · p95 2.19 ms | p50 0.59 ms · p95 1.15 ms |
  | 100,000 episodes | p50 4.31 ms · p95 40.1 ms | p50 0.60 ms · p95 1.85 ms |

- **LongMemEval retrieval benchmark** ([#14](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/14)): `npm run bench:longmemeval` scores session-level retrieval on LongMemEval-S (MIT, 470 questions with evidence). With local hashing: evidence session in the top 4 for 52.8% of questions, in the top 10 for 71.3%; weakest on preference questions (20.0% @4) and on questions that need every evidence session (26.4% @4). Retrieval only; answer accuracy needs an LLM and is not measured yet.
- **Benchmark a running hub over HTTP** (`npm run bench -- --url …`, part of [#15](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/15)): scores a deployed hub through its REST APIs with temporary agents that are deleted afterwards. Gives the same numbers as the in-process run. `POST /api/sleep/tick` runs one automatic-sleep pass on demand.
- Benchmark category `exact_match`: order numbers that differ by a digit, with and without their prefix, and device model names. The suite now has 25 scenarios.

### Fixed

- Embedding backfill stalled with long texts on CPU models: big batches timed out on every retry, so indexing never finished. The batch size now halves on a timeout, and background embedding gets a 120 s timeout.
- Benchmark scripts could exit silently when embedding failed; they now report the error.

## [0.3.0] - 2026-10-09

The memory is now **measured** and **retrieves by meaning**. See the benchmark table in the README.

### Added

- **Semantic search with real embedding models** ([#17](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/17)). Pick OpenAI, Gemini, Ollama, vLLM, LM Studio or any OpenAI-compatible `/embeddings` endpoint in **Settings → Semantic search**, or with `BRAIN_EMBED_*`. Opt-in: local feature hashing stays the default, and a provider key alone doesn't enable it. Writes never wait on the network: a background queue adds model vectors and re-indexes when the model changes. Queries fall back to hashing after 1.5 s. Only redacted text is embedded. On the memory benchmark (23 scenarios):

  | | Hashing | `bge-m3` (Ollama, CPU) |
  |---|---|---|
  | Scenario pass rate | 82.6% | **95.7%** |
  | Recall accuracy | 88.5% | **100%** |
  | Leak rate | 0% | 0% |
  | recall p50 | 0.5 ms | 94 ms |

- `npm run bench -- --embed` runs the benchmark with the configured embedding model; three paraphrase scenarios were added (questions that share no words with the memory).
- Failed benchmark checks explain facts dropped below the relevance threshold.
- **CI benchmark gate** ([#16](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/16)): CI runs the benchmark and fails if scenario pass rate, recall accuracy, stale-use rate, conflict handling or reply accuracy gets worse than the committed baseline (`npm run bench -- --gate bench/results/0.3.0.json`), or if anything leaks. Results appear in the job summary. Benchmark results table in the README.
- **Memory benchmark** (`npm run bench`, [#12](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/12)): multi-agent scenarios across six categories (cross-agent recall, stale facts, contradictions, leakage, multi-hop, long conversations), in English plus Vietnamese and Japanese cases. Reports recall accuracy, leak rate, stale-use rate, conflict handling, latency and prompt tokens, offline and deterministic; `--llm` also scores replies. Scenarios are JSON files, so adding one needs no code. Results per version in `bench/results/`.
- **Every memory says who wrote it and how old it is.** The prompt block now reads `availability: no car for 3 days (from Kai, 2 days ago, expires in 2 days)` instead of just the fact, and the model is told to prefer recent facts and confirm old ones that matter. `/v1/recall` returns `updatedAt` and `validUntil` for each memory, so connected agents can make the same call. ([#11](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/11))

### Changed

- `Brain.recall()` is now async (it may wait for a query embedding). The REST API, SDK and MCP server are unaffected; in-process callers need `await`.

### Fixed

- SQLite: updating a fact or episode rewrote its JSON but not its vector columns.

## [0.2.0] - 2026-10-07

### Added

- **Automatic sleep cycle.** The brain now sleeps on its own: after a customer has been quiet for 30 minutes (idle), as soon as 24 turns are waiting (pressure), and once a night at 03:00 server time. Configure it in **Settings → Sleep cycle**, which also shows who is waiting and the recent runs with their trigger, or with `BRAIN_SLEEP_*` environment variables. The **Run sleep cycle** button still works; manual and automatic runs are queued so they never overlap. Automatic runs appear live in the brain view.
- `GET /api/settings/sleep` and `PUT /api/settings/sleep`.
- A security policy (`SECURITY.md`) with private vulnerability reporting, a code of conduct, and weekly Dependabot updates for npm, Docker and GitHub Actions.

### Fixed

- Long conversations lost turns: working memory keeps only the last 40 turns, so anything older was dropped before it was ever consolidated unless someone pressed **Run sleep cycle**. The pressure trigger consolidates before that happens.

## [0.1.1] - 2026-10-07

### Fixed

- Crash on Node 24 (`Assertion failed: (env) != nullptr` in `node::RemoveEnvironmentCleanupHook`): better-sqlite3 11 can abort the process when V8 garbage-collects a dropped prepared statement while the event loop is idle. It reliably crashed the test suite on Node 24 and could in principle hit the server too. Fixed by upgrading to better-sqlite3 13.
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

[Unreleased]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/releases/tag/v0.1.0
