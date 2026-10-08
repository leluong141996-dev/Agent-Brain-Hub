# Roadmap

Agent Brain Hub aims to be **the memory layer for multi-agent systems: correct over time, governed, and measured.**

Most memory libraries are built for one agent. When several agents share one memory, the hard problems move: who may read what, which write wins, when a fact stops being true, and how you prove the memory actually helps. This roadmap is about those problems.

It's a plan, not a promise. Priorities change with feedback: comment on the milestone issues or open a [Discussion](https://github.com/leluong141996-dev/Agent-Brain-Hub/discussions).

## Where we are (v0.2)

**Solid today**
- Shared memory with governance: private / shared / global scopes, one writer domain per relation, per-agent permissions, append-only audit log.
- Every request traced live through 13 brain regions; facts carry their source, age and expiry into the prompt.
- Automatic sleep cycle (idle, pressure, nightly), TTL-based forgetting, contradiction flagging, skill promotion.
- Runs offline with zero configuration, or with any LLM. REST, JS SDK and MCP. English, Vietnamese, Japanese.

**Still basic**

| Limitation | Today |
|---|---|
| Closed schema | 19 predefined relations and 35 regex rules. LLM extraction is limited to the same list, so anything outside it (say, a favourite colour) is not remembered. |
| Lexical retrieval | Feature-hashing embeddings (256 dims) and a linear scan over a customer's memories. |
| Coarse time | A fact has a TTL and is deleted when it expires. There's no way to ask what the brain believed at a given moment. |
| No graph | Facts hang off a customer. No relations between entities, no entity resolution. |
| Not measured | No benchmark for recall accuracy, stale-fact use or leakage. The value dashboard's "time saved" is an estimate (20 s per question). |
| Single process | State lives in memory; SQLite is the persistence layer. |

## Principles

These hold for every milestone:

1. **Measure first.** A change to memory quality ships with numbers from the benchmark, before and after.
2. **Zero-config stays.** `docker compose up` with no keys keeps working. Every new capability has an offline fallback.
3. **Governance is not optional.** New memory paths (graph traversal, open schema, LLM consolidation) go through the same scope and permission checks, and are covered by leak tests.
4. **One pillar per release.** Small, finished releases over many half-built features.
5. **The brain stays visible.** New behaviour shows up in the live trace.

## Milestones

### v0.3: Measure, then retrieve better

*Goal: know how good the memory is, and make retrieval semantic.*

- [x] **Memory benchmark** (`npm run bench`, [#12](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/12)) with multi-agent scenarios:
  - cross-agent recall;
  - acting on stale facts;
  - contradictions;
  - private-data leakage;
  - multi-hop questions;
  - long conversations.

  Metrics: accuracy, leak rate, latency, prompt tokens, cost.
- [ ] A public long-term-memory dataset in the same harness (LongMemEval-style), so results compare with other systems.
- [ ] Run the benchmark through [Argus](https://github.com/leluong141996-dev/Argus), the agent evaluation platform.
- [x] Pluggable embeddings: OpenAI, Gemini, Ollama, vLLM, LM Studio or any OpenAI-compatible endpoint (e.g. bge-m3, which handles Vietnamese and Japanese). Feature hashing stays as the offline fallback. ([#17](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/17))
- [ ] Hybrid retrieval: keyword (SQLite FTS5) + vector (sqlite-vec) + recency, fused with Reciprocal Rank Fusion; optional reranker.
- [ ] Benchmark results table in the README; CI fails if a tracked metric regresses.

**Done when** the README shows benchmark numbers for v0.2 vs v0.3, measured by the same harness.

### v0.4: A temporal knowledge graph

*Goal: memory that is correct over time, and connected.*

- [ ] **Bi-temporal facts.** Each fact has *valid time* (when it is true in the world) and *record time* (when the brain learned it, and when it was invalidated). Facts are invalidated, not deleted. Retention policies still purge old data.
- [ ] **Point-in-time recall:** `recall({ asOf })` answers "what did the brain believe then?". Use it to debug questions like "what did Atlas know when it booked the flight?"
- [ ] **Entities as nodes, relations as edges**, with entity resolution ("John" = "Mr. Smith" = customer `kh-001`).
- [ ] Multi-hop retrieval over the graph (customer → car → repair shop), inside the same permission checks.
- [ ] A time slider in the UI to replay memory state; graph view of a customer's entities.

**Done when** the stale-fact and multi-hop benchmark scores improve over v0.3, and `asOf` queries are covered by tests.

### v0.5: Open schema and multi-agent consistency

*Goal: remember anything, and keep many writers consistent.*

- [ ] **Open-schema extraction.** The LLM may extract any relation. The ontology becomes a **policy registry**: known relations keep their scope, TTL and owner. New relations start as *provisional* with a safe default (private, short TTL) and are promoted as they're used.
- [ ] **Write-arbitration policies per relation:** owner wins, latest wins, confidence-weighted, or human required.
- [ ] **Agent trust scores**, learned from how often an agent's facts are corrected or superseded.
- [ ] **Conflict resolution during sleep:** an LLM proposes a resolution with evidence, and a review queue in the UI lets a human accept it.
- [ ] Memory tools for agents over MCP and REST: `brain_correct`, `brain_forget`.
- [ ] LLM consolidation in the sleep cycle: distil episodes into facts, merge duplicate entities.

**Done when** the benchmark's contradiction and long-conversation scores improve, and "favourite colour" is remembered and recalled.

### v0.6: Production governance and scale

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
- Rename the `semantic (graph + SQL)` trace label to match what exists until v0.4 ships.

## Not planned

- **A hosted service.** Agent Brain Hub is self-hosted.
- **An agent framework.** The hub is memory; agents are built with whatever you like.
- **Training or fine-tuning models.**

## How to help

- Pick a [`good first issue`](https://github.com/leluong141996-dev/Agent-Brain-Hub/labels/good%20first%20issue), or comment on a milestone item you'd like to take.
- **Scenarios for the benchmark are especially welcome.** If memory between your agents went wrong in a real system, describe it in an issue; it may become a test case.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the PR process.
