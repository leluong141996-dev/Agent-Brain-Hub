# Roadmap

Agent Brain Hub aims to be **the memory layer for multi-agent systems: correct over time, governed, and measured.**

Most memory libraries are built for one agent. When several agents share one memory, the hard problems move: who may read what, which write wins, when a fact stops being true, and how you prove the memory actually helps. This roadmap is about those problems.

It's a plan, not a promise. Priorities change with feedback: comment on the milestone issues or open a [Discussion](https://github.com/leluong141996-dev/Agent-Brain-Hub/discussions).

## Where we are (v0.6)

**Solid today**
- Shared memory with governance: private / shared / global scopes, one writer domain per relation, per-agent permissions, append-only audit log.
- Every request traced live through 13 brain regions; facts carry their source, age and expiry into the prompt.
- Automatic sleep cycle (idle, pressure, nightly), TTL-based forgetting, contradiction flagging, skill promotion.
- Runs offline with zero configuration, or with any LLM. REST, JS SDK and MCP. English, Vietnamese, Japanese.
- Correct over time: facts are invalidated rather than deleted, and `recall({ asOf })` shows what the brain believed at any moment.
- Connected: facts are grouped into entities per customer, and retrieval follows links between them (multi-hop), explaining each added fact with `via`, inside the same permission checks.
- Measured: a 37-scenario memory benchmark with a CI gate, plus LongMemEval-S retrieval. Hybrid semantic + lexical search with real embedding models; a per-customer index keeps retrieval under 2 ms at 100,000 episodes.

**Still basic**

| Limitation | Today |
|---|---|
| Closed schema | 19 predefined relations and 35 regex rules. LLM extraction is limited to the same list, so anything outside it (say, a favourite colour) is not remembered. |
| Retrieval quality on long histories | On LongMemEval-S, hashing finds the evidence session in the top 4 for about half the questions; preferences and multi-session questions are weakest. |
| A narrow graph | Entities are assets, trips and profile groups, found with a lexicon; one node per asset type per customer, so two cars are one node. No people or organisations yet. The affinity table is hand-written. |
| Answers not measured | Benchmarks score what reaches the agent (37 own scenarios, LongMemEval retrieval), not the final answers. The value dashboard's "time saved" is an estimate (20 s per question). |
| Single process | State lives in memory; SQLite is the persistence layer. |

## Principles

These hold for every milestone:

1. **Measure first.** A change to memory quality ships with numbers from the benchmark, before and after.
2. **Zero-config stays.** `docker compose up` with no keys keeps working. Every new capability has an offline fallback.
3. **Governance is not optional.** New memory paths (graph traversal, open schema, LLM consolidation) go through the same scope and permission checks, and are covered by leak tests.
4. **One pillar per release.** Small, finished releases over many half-built features.
5. **The brain stays visible.** New behaviour shows up in the live trace.

## Milestones

### v0.3: Measure, then retrieve better ✅ released

*Goal: know how good the memory is, and make retrieval semantic.*

- [x] **Memory benchmark** (`npm run bench`, [#12](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/12)) with multi-agent scenarios: cross-agent recall, stale facts, contradictions, private-data leakage, multi-hop questions, long conversations. Metrics: accuracy, leak rate, latency, prompt tokens.
- [x] Pluggable embeddings: OpenAI, Gemini, Ollama, vLLM, LM Studio or any OpenAI-compatible endpoint (e.g. bge-m3, which handles Vietnamese and Japanese). Feature hashing stays as the offline fallback. ([#17](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/17))
- [x] Benchmark results table in the README; CI fails if a tracked metric regresses. ([#16](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/16))

**Result:** with `bge-m3`, recall accuracy went from 88.5% to 100% and scenario pass rate from 82.6% to 95.7%, with no leaks (see the README).

### v0.4: Hybrid retrieval and external benchmarks ✅ released

*Goal: fast retrieval at scale, exact matches for names and codes, and numbers that compare with other systems.*

- [x] Hybrid retrieval ([#13](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/13)): model + lexical similarity (CombSUM), so embeddings never lose exact matches; a per-customer index instead of a scan. Done in memory rather than with FTS5 / sqlite-vec: the brain's state lives in memory and SQLite is written behind it, so an index in SQLite would lag fresh writes. A database-side index comes with the PostgreSQL adapter.
- [x] A public long-term-memory dataset ([#14](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/14)): LongMemEval-S, session-level retrieval recall@k.
- [ ] Run the benchmark through [Argus](https://github.com/leluong141996-dev/Argus) ([#15](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/15)). This repo's side is done: the benchmark can score any running hub over HTTP. The Argus plugin remains.

**Result:** recall latency at 100,000 episodes went from p95 40 ms to 1.9 ms. LongMemEval-S with local hashing: evidence session in the top 4 for 52.8% of questions, in the top 10 for 71.3%.

### Next: memory that reads like memory

- Harder multi-hop scenarios: longer chains, more distractors, entities that an embedding model alone does not link.
- Answer accuracy on LongMemEval with an LLM (needs a GPU run), and embedding-model numbers on it.
- Retrieval quality on LongMemEval's weak spots: preferences (20% @4) and questions that need every evidence session (26% @4).

### v0.5: Memory over time ✅ released

*Goal: memory that is correct over time.*

- [x] **Bi-temporal facts.** Record time (`recordedAt`, `invalidatedAt`) and valid time (`validFrom`, `validUntil`). Facts are invalidated, not deleted; sleep purges them after a history period (90 days by default).
- [x] **Point-in-time recall:** `recall({ asOf })` answers "what did the brain believe then?", read-only and within the same permissions.
- [x] A "view memory as of" control in the UI, with each fact's replacement history.
- [x] Fix [#22](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/22): a changed preference replaces the old one.

**Result:** stale-use rate 25% → 0%; the new `temporal` benchmark category passes 100%; with `bge-m3` all 29 scenarios pass.

### v0.6: An entity graph ✅ released

*Goal: memory that is connected.* Split from v0.5, which shipped the time model first.

- [x] **Entities per customer**, with entity resolution inside one customer ("my car" = "xe" = "車" = the Honda Civic; "Da Nang" = "Đà Nẵng"). Customers are never merged automatically.
- [x] Multi-hop retrieval by spreading activation (customer's Civic → the car in the shop; a trip → the car being unavailable), only over memories that already passed the permission and time checks. Added facts carry `via`.
- [x] A Graph tab in the UI and `GET /api/graph`, both with `asOf`.

**Result:** with hashing, multi-hop passes 100% (40% without the graph, measured with `--no-graph`), overall 81.1% → 97.3%; leak rate 0%. With `bge-m3` the multi-hop scenarios pass even without the graph, so they are not yet hard enough to show its value there.

**Not done:** people and organisations as entities ("John" = "Mr. Smith"), and more than one asset of a type per customer. Both need LLM extraction, planned with the open schema in v0.7.

### v0.7: Open schema and multi-agent consistency

*Goal: remember anything, and keep many writers consistent.*

- [ ] **Open-schema extraction.** The LLM may extract any relation. The ontology becomes a **policy registry**: known relations keep their scope, TTL and owner. New relations start as *provisional* with a safe default (private, short TTL) and are promoted as they're used.
- [ ] **Write-arbitration policies per relation:** owner wins, latest wins, confidence-weighted, or human required.
- [ ] **Agent trust scores**, learned from how often an agent's facts are corrected or superseded.
- [ ] **Conflict resolution during sleep:** an LLM proposes a resolution with evidence, and a review queue in the UI lets a human accept it.
- [ ] Memory tools for agents over MCP and REST: `brain_correct`, `brain_forget`.
- [ ] LLM consolidation in the sleep cycle: distil episodes into facts, merge duplicate entities.
- [ ] Richer graph entities from LLM extraction: people and organisations, and several assets of one type per customer.

**Done when** the benchmark's contradiction and long-conversation scores improve, and "favourite colour" is remembered and recalled.

### v0.8: Production governance and scale

*Goal: something a team can run for real.*

- [ ] **Policy as code** (YAML): purpose-based access, e.g. the travel agent may read `allergic_to` only when choosing a meal. Policies are tested like code.
- [ ] Tamper-evident audit log (hash chain).
- [ ] Customer data export and delete ([#4](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/4)); more PII formats ([#2](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/2)).
- [ ] PostgreSQL + pgvector storage adapter; several hub processes behind a load balancer; sleep jobs on a worker queue.
- [ ] OpenTelemetry export of brain traces (Jaeger, Langfuse, …); Prometheus metrics.
- [ ] Multi-tenancy; scoped, expiring API keys; per-agent rate limits.

**Done when** two hub instances share one PostgreSQL database under load, with the full test suite and benchmark passing.

### v1.0: Stable and documented

- [ ] Stable, versioned Brain API (`/v1`) and SDKs: JS, Python ([#1](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/1)).
- [ ] Adapters for agent frameworks (LangGraph, CrewAI, OpenAI Agents SDK).
- [ ] Documentation site with architecture, governance model and benchmark methodology.
- [ ] Published benchmark report.

## Housekeeping (any time)

- Move the six demo agents and their domains into `examples/`, so the core is domain-agnostic.
- Label the value dashboard's estimates as estimates until they're measured.
- ~~Rename the `semantic (graph + SQL)` trace label to match what exists~~ (done in v0.4: `semantic (facts)`).

## Not planned

- **A hosted service.** Agent Brain Hub is self-hosted.
- **An agent framework.** The hub is memory; agents are built with whatever you like.
- **Training or fine-tuning models.**

## How to help

- Pick a [`good first issue`](https://github.com/leluong141996-dev/Agent-Brain-Hub/labels/good%20first%20issue), or comment on a milestone item you'd like to take.
- **Scenarios for the benchmark are especially welcome.** If memory between your agents went wrong in a real system, describe it in an issue; it may become a test case.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the PR process.
