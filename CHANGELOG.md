# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Configurable domains.** Define your own agent specialties without editing code: intents with keywords, how long memories live, private or shared sessions, and the relations each intent should bring up. Over the admin API (`GET /api/domains`, `PUT` / `DELETE /api/domains/:id`, persisted with the brain) or in a JSON file named by `BRAIN_DOMAINS`, which is read-only over the API ([examples/domains.json](examples/domains.json)). Built-in domains cannot be changed; a domain in use cannot be deleted. **Settings → Domains** lists them all.

- **A software-engineering domain.** Connected agents can now be an architect, a coder or a QA agent sharing one brain about a project: the seventh domain, `engineering` (intents design / implement / review_test, actions "add a regression test" and "record the decision as an ADR"), and two built-in relations, `known_pitfall` and `convention` (sets, shared, kept for a year). The "customer" is the repository. [examples/dev_team.py](examples/dev_team.py) runs the story end to end.
- **A LangGraph example**: shared memory as a `recall` node before the model and a `remember` node after it ([examples/langgraph_memory.py](examples/langgraph_memory.py), tested with LangGraph 1.2.17).
- **README**: the dev-team example and the two-call Python integration come first, and a *Why Agent Brain Hub?* section compares it with Mem0, Letta and Zep / Graphiti from their own docs, including where they are stronger.

## [0.8.4] - 2026-10-27

Closes the 9.1% the memory firewall still let through with a real LLM, and fixes two flaws found in review.

### Changed

- **Instructions are cut from the message as it comes in.** With a local LLM, v0.8.3 let 1 of 11 poison checks through: the model had read the planted request and restated it in its own words, which no pattern filter catches. The brainstem now cuts instruction-like sentences from a customer's message (after PII redaction) before the reply, fact extraction or the session summary sees it. The rest of the message is answered as usual; the audit log records each cut (`firewall`, `clean: input`). A re-run of the 7 `memory_poisoning` scenarios with `qwen3:4b` passed all 11 checks (one run; the v0.8.3 leak appeared in one run out of four). Trade-off: the agent being asked ignores the instruction silently instead of refusing it.

### Fixed

- **Memory firewall: a customer could strip an honest agent of its trust.** Dismissing a held write always penalized the agent, but a customer can type an instruction to any agent, which then extracts it faithfully. After enough dismissals the honest agent fell below the trust floor and could no longer update shared facts. Now only text the agent itself supplied (`remember` facts, `brain_correct`) counts against it.
- **Memory firewall: an instruction posing as a correction destroyed the real value.** `brain_correct` invalidated the old fact first and only then wrote the new value, which the firewall held. The correction is now checked first: it is held and nothing is invalidated.

## [0.8.3] - 2026-10-20

A memory firewall: instructions planted in memory by one agent or one message must not reach the others.

### Added

- **Memory firewall** (`server/brain/firewall.js`, no LLM needed; `BRAIN_FIREWALL=off` disables it). A fact whose value reads like an instruction (override, action directive, a `system:` turn, hidden characters; English, Vietnamese, Japanese) is **held**, not written. A write from an agent whose trust is below 0.3 over a value another agent wrote is held too. In **Review → Held by the memory firewall** a person allows it (written like any fact) or dismisses it (counts against the agent's trust). Admin API: `POST /api/review/release` and `/api/review/dismiss`; `GET /api/review` lists `held`. The audit log has a `firewall` operation (hold, release, dismiss, clean); a customer's held writes are in their export and erased with them.
- **Instruction-like sentences are removed** from session summaries and from the turns other agents read (working memory and handoffs). The rest of the message stays: an order that is late is still found.
- **Benchmark: `memory_poisoning`**, 7 scenarios (override in an order note, a compromised agent writing a directive into a shared relation, a fake `system:` turn, an exfiltration address, Vietnamese, Japanese, and one that checks ordinary "always"/"never" preferences are not blocked). New check `poison: [...]` (the text must not reach the agent), metric **Poison rate** (the CI gate requires 0), and `--no-firewall` to run the same set without it.

  | 0.8.3 | Hashing (offline) | Hybrid with `bge-m3` | Hashing, `--no-firewall` |
  |---|---|---|---|
  | Scenario pass rate (63) | 98.4% | 98.4% | 90.5% |
  | Poison rate (11 checks) | 0% | 0% | 90.9% |
  | Leak rate | 0% | 0% | 0% |

  The scenarios are our own and were written with the filter in mind; see the ROADMAP for what it does not catch.

- **A full run with a local LLM** (`qwen3:4b`, 65 scenarios, 4 h 27 min): 95.4% pass, recall 97.4%, leak 0%, stale-use 0%, poison rate 9.1% (1 of 11: a Japanese scenario where 送金 reached another agent; not reproduced in three re-runs, probably the LLM restating the planted request, which the firewall does not catch). `exact-order-newer-status` failed in that run because its checks matched exact words an LLM rewrites; the checks now look at distinctive details and pass with the LLM in a separate run.

## [0.8.2] - 2026-10-19

A small fix found by a reader's question: what happens when two sessions say different things about the same order.

### Fixed

- **Newer wins for one identifier.** "Order ORD-48207 was cancelled" and, two days later, "ORD-48207 has shipped": both stay as history, but a question that names the order now ranks the newer session above the older one. Before, the older one could rank slightly ahead, because recency is a small part of the score. A different order (`ORD-48199`) still ranks below both. This does not decide which statement is *true*; it makes the newest word the first one the agent reads.

### Added

- **A new benchmark check, `order: [[a, b]]`**: `a` must appear above `b` in the recalled memories. The scenario `exact-order-newer-status` uses it (56 scenarios; it fails without the fix).

| 0.8.2 | Hashing (offline) | Hybrid with `bge-m3` |
|---|---|---|
| Scenario pass rate (56) | 98.2% | 98.2% |
| Leak rate | 0% | 0% |

The LLM column in the README is still the v0.8.0 run.

## [0.8.1] - 2026-10-17

A hardening release before v0.9: data protection, a Python client, honest multi-hop scenarios, and two retrieval fixes.

### Added

- **Export and erase one customer** ([#4](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/4)). `GET /api/customers/:id/export` returns everything the brain holds about the customer as one JSON file, every fact with its history; `DELETE /api/customers/:id` erases it all (facts in every version, episodes, working memory, insights, traces, decisions, sleep history, the id and values in learned relations, matching events of the live log) and survives a restart. Admin only; the append-only audit log keeps ids and counts (an `erase` entry), never a value; company-wide policies (`*`) cannot be erased. A *Customer data* card in Settings does both (erase asks you to type the id).
- **More PII formats** ([#2](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/2)): US social security numbers (formatted, never 000 / 666 / 9xx), IBANs (valid check digits), and international phone numbers. Order numbers, dates and amounts are not redacted.
- **A Python client** ([#1](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/1)): `sdk/brain_client.py`, standard library only, the same calls and errors as the JS client, including `correct` and `forget`. The JS client's `recall` now takes `asOf`.
- **Five harder multi-hop scenarios** (15 in all): the question only names a trip or a car, and the facts hang off it, including a two-hop chain and a dozen unrelated facts. With hashing, multi_hop is 100% with the graph and 26.7% without. The Audit page can filter the operations added since v0.7.

  | 0.8.1 | Hashing (offline) | Hybrid with `bge-m3` |
  |---|---|---|
  | Scenario pass rate (55) | 98.2% | 98.2% |
  | multi_hop (15) | 100% | 93.3% |
  | Leak rate | 0% | 0% |

  `bge-m3` fails `multi-hop-trip-among-many-facts` with or without the graph: its scores are not calibrated (see the ROADMAP). The LLM column in the README is still the v0.8.0 run.

### Fixed

- **Insights outlived the facts they described.** An LLM insight such as "planning a trip to Tokyo next week" had no expiry, and reflection re-read the last 15 episodes whatever their age, so a stale insight could even be regenerated from an old session. Insights now live 30 days and are built only from the last month's episodes.
- **Facts pulled in by the entity graph lost the top-10 cut** to generic profile facts when a customer had a dozen facts (score 0.17). They now score about 0.4 one hop away and 0.34 two hops away.

### Changed

- The dashboard's time saved reads "≈ N minutes saved (an estimate) · assuming 20 seconds per question".

## [0.8.0] - 2026-10-16

Memory that **maintains itself**: agents correct and forget, sleep learns from whole sessions, and an LLM proposes how to settle conflicts.

### Added

- **`brain_correct`** (`POST /v1/correct`, SDK `correct()`, MCP tool). An agent corrects a fact it can see. The wrong value is invalidated with reason `corrected` and kept as history (still visible with `asOf`); an optional new value replaces it; the agent that wrote the wrong value loses trust (once per correction). An agent gets the same "not found" whether the fact does not exist or is another domain's private data.
- **`brain_forget`** (`POST /v1/forget`, SDK `forget()`, MCP tool). On a customer's request, the facts of a relation that the agent can see (or only one value) are **deleted** in every version, with their vectors, and the value is scrubbed from the episodes, conversation turns, traces, working-memory context and event log the agent can see. The audit entry records the relation and counts, never the value. Matching is word for word (plurals, short Japanese / Vietnamese values and numbers included); a summary an LLM wrote in other words may still describe it, and the tool says so. Company-wide policies cannot be corrected, forgotten or written by agents.
- **Facts from whole sessions.** With an LLM, sleep re-reads each session it stores and extracts durable facts from the whole conversation, through the normal write path as the session's agent (registry, scope, write policy, audit), marked `origin: consolidation`. At most 10 per session. A value an agent corrected is not brought back.
- **LLM-proposed conflict resolutions.** During sleep, with an LLM, each open conflict (at most 5 per sleep) gets advice: keep one value, or "not sure", with a reason, from both values, who wrote them, what the customer said and recent conversations. It is never applied automatically: the Review page shows it and *Accept proposal* settles the conflict through the normal path (trust updates; audited as a proposal). A pair is asked once.
- **Benchmark:** `correct` and `forget` steps, a `maintenance` category (50 scenarios in total, plus two that need an LLM), covered over HTTP too.

  | 0.8.0 | Hashing (offline) | Hybrid with `bge-m3` | With an LLM (qwen3:4b, local) |
  |---|---|---|---|
  | Scenario pass rate | 98.0% | 100% | 94.2% |
  | maintenance | 100% | 100% | 80% |
  | Leak rate | 0% | 0% | 0% |

  Two LLM scenarios depend on how a 4B model words things and can vary between runs (see the README). LongMemEval-S retrieval is unchanged (53.2% @4).

### Changed

- The MCP server reports the package version, and `brain_remember`'s description no longer lists only the 19 built-in relations.
- Accepting a conflict value that is no longer current (it was corrected, replaced or resolved) is refused with 409 instead of wiping both sides.
- Correcting or forgetting one side of a conflict releases the other side.

### Fixed (found by running the whole suite with a local LLM)

- **Sleep brought back what the customer had moved on from.** When two agents spoke back to back and sleep came after, consolidation re-read the older session ("I live in Hanoi") and wrote Hanoi again, in conflict with the newer Saigon. A transcript no longer brings back a value that was replaced, corrected or lost, nor contradicts a newer value of a single-valued relation.
- **"Do I have any food allergies?" found nothing.** No intent covered the word and the fact text shares no word with the question. Offline the benchmark passed only because the extractive session summary repeated "peanuts". Allergy words now count as a health check (vi / en / ja).
- **"How many children do I have?" found the children fact only when it was flagged as a conflict.** A question that names a relation now reaches its fact, for built-in relations too (before, only learned ones). Words every sentence has ("with", "has", "for"…) never name a relation. Prompts are 2 tokens longer on average.

### Fixed (found by the independent review of this release)

- Any agent with write permission could delete or rewrite company-wide policies through `/v1/correct`, `/v1/forget` or `/v1/remember`. Agents can no longer touch customer `*`.
- A replacement value that would be rejected deleted the old value anyway; it is now checked first and reported as an error.

## [0.7.0] - 2026-10-10

Memory that **remembers anything**, and stays **consistent when several agents write**.

### Added

- **Open schema.** The 19 built-in relations become a registry (Settings → *Memory schema*, `GET/PUT/DELETE /api/relations`). A relation the brain has not seen before is no longer dropped: it starts **provisional**, private to the domain that wrote it, with a 30-day TTL. New relations come from three places:
  - an LLM may propose one ("I'm a gold member" → `loyalty_tier`);
  - offline, "my favourite X is Y" in English, Vietnamese and Japanese becomes `favourite_<noun>`, with one name across languages;
  - a connected agent may send any relation through `/v1/remember`.

  An admin promotes a provisional relation (scope, owner, policy, labels; facts already stored follow), merges it into another one, or deletes it. Nothing is widened automatically. Names that contain a secret (`password`, `pin`, `card_number`…) are refused, and values are PII-redacted.
- **Write policies per relation.** When two agents write different values, the relation's policy decides:
  - `latest`: the newer value wins (trip, budget, car availability…);
  - `owner`: the owner domain wins (income, payment method);
  - `trust`: the more trusted agent wins (profile facts);
  - `human`: a person decides.

  The loser is kept as history (`outvoted`, visible with `asOf`). Every automatic decision is audited, shown in the trace, and can be **undone**. A customer saying something changed always wins. If the customer contradicts themselves (the same agent writes both values), the brain asks them instead of picking.
- **Agent trust scores**, learned from outcomes: which value a human keeps, undone decisions, and other agents confirming a value. They are shown on the Agents screen.
- **Review page.** It lists conflicts waiting for a person (side by side, with source, trust and evidence), automatic decisions of the last 30 days with *Undo*, and new relations worth promoting. The sidebar shows how many conflicts are waiting.
- **Benchmark:** `open_schema` and `arbitration` categories (46 scenarios in total), `remember` and `promote` steps, and scenarios that need an LLM (`requires: "llm"`, skipped offline).

  | 0.7.0 | Hashing (offline) | Hybrid with `bge-m3` |
  |---|---|---|
  | Scenario pass rate (46) | 97.8% | 100% |
  | open_schema / arbitration | 100% / 100% | 100% / 100% |
  | Leak rate | 0% | 0% |

  With a local LLM (`qwen3:4b` on Ollama), exact-match scenarios went from 0% to 100% and `open_schema` passed 100%; a full LLM run will follow.

  LongMemEval-S retrieval: 52.8% → 53.2% @4.

### Fixed

- **Local reasoning models answered nothing.** Qwen3 builds on Ollama (the default Ollama model) always think. With the local token cap they used the whole budget thinking and returned an empty answer, so fact extraction silently found nothing. An empty answer is now retried once with room for the reply.
- **LLM session summaries lost order numbers and model names** ("ORD-48207", "WH-1000XM5"), and described "this session" instead of the customer. Summaries now copy identifiers exactly.
- **A question naming an exact identifier** ("order 48207", "WH-1000XM5") reaches the memory that contains it, even among many similar conversations. With an LLM, exact-match questions went from 0% to 100%.
- **"How much do I earn?"** now reaches the income fact (income words in vi / en / ja).
- **Retrieval excluded only some kinds of replaced facts.** A value that lost an automatic decision would have reached the prompt. Every invalidated fact is now excluded.
- **Resolving one of three or more clashing values** settles all of them.

## [0.6.2] - 2026-10-09

### Fixed

- **Turns were lost before they reached long-term memory.** Turns that arrived while sleep waited on a slow summarizer were cut when working memory was trimmed afterwards: with a 300 ms summarizer and 8 messages during sleep, 10 of 26 turns were lost. And past 40 turns, working memory evicted the oldest turn even if it had never been consolidated. Now a turn is only evicted once it is in a stored episode, and when pending turns reach the cap the brain sleeps right away instead of waiting for the scheduler. A burst test with a delayed summarizer guards it. Thanks to Ahmet Özel, who suggested that test.

## [0.6.1] - 2026-10-09

### Fixed

- A Vietnamese preference change ("Tôi không thích ăn cay nữa") became a conflict instead of replacing "Tôi thích ăn cay": "nữa" / "nữa rồi" now mark an update ([#23](https://github.com/leluong141996-dev/Agent-Brain-Hub/pull/23), thanks [@nova-loop](https://github.com/nova-loop)).
- A final full stop or exclamation mark no longer hides an update marker ("…nữa.", "I hate onions now.").

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

[Unreleased]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/leluong141996-dev/Agent-Brain-Hub/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/leluong141996-dev/Agent-Brain-Hub/releases/tag/v0.1.0
