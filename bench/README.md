# Memory benchmark

`npm run bench` scores the shared memory as a whole: does one agent's knowledge reach the others, do expired facts stay out, are contradictions handled, does private data stay private? It runs offline and deterministically in about a second, so every change can show before/after numbers.

```bash
npm run bench                                         # offline, prints the report
npm run bench -- --filter leakage                     # one category, or one scenario id
npm run bench -- --compare bench/results/0.2.0.json   # adds a delta column
npm run bench -- --llm                                # with the configured LLM (UI settings or BRAIN_LLM_* env)
npm run bench -- --save                               # writes bench/results/<version>.json
npm run bench -- --gate bench/results/0.8.4.json      # what CI runs: exit 1 if a quality metric got worse
npm run bench -- --url http://localhost:4317          # a running hub, as it is configured (add --token if it has one)
npm run bench -- --no-graph                           # ablation: the same run without the v0.6 entity graph
npm run bench -- --no-firewall                        # ablation: the same run without the v0.8.3 memory firewall
npm run bench:scale                                   # retrieval latency with 20,000 episodes (--episodes, --customers)
```

**The CI gate** fails a PR if scenario pass rate, recall accuracy, stale-use rate, conflict handling or reply accuracy gets worse than the committed baseline, or if anything leaks or any planted instruction reaches an agent (leak rate and poison rate must be 0). Latency and prompt tokens are reported but not gated. If a change is meant to move a number (for example, a new scenario that the current memory fails), re-save the baseline with `--save` in the same PR and say why in the description.

**What the entity graph is worth** (`--no-graph`): the `multi_hop` scenarios are written so the answer needs a link the question does not state: "the XPS" is the laptop at the repair shop, planning a trip should bring up that the car is in the shop, "シビック" is the car being repaired. With hashing, multi_hop passes 100% with the graph and 26.7% without it (15 scenarios), overall 98.4% vs 81.0%, for about 5 more prompt tokens. `multi-hop-trip-allergy-private` checks the other side: the graph must not carry a private fact to an agent outside its domain.

## Latest results

| v0.8.4 | Hashing (default, offline) | Hybrid with `bge-m3` (Ollama, CPU) | With an LLM (`qwen3:4b`, local) |
|---|---|---|---|
| Scenario pass rate | 98.4% | 98.4% | 95.4% (65) |
| Recall accuracy | 98.6% | 98.6% | 97.4% |
| Open schema / arbitration / maintenance | **100%** / **100%** / **100%** | **100%** / **100%** / **100%** | **100%** / **100%** / **100%** |
| Multi-hop questions (15) | **100%** (26.7% without the graph) | 93.3% | **100%** |
| Leak rate | **0%** | **0%** | **0%** |
| Poison rate (11 checks) | **0%** (90.9% with `--no-firewall`) | **0%** | **0%**\*\*\* |
| Stale-use rate | **0%** | **0%** | **0%** |
| recall latency (p50) | 0.5 ms | 104 ms | 0.8 ms |
| Prompt tokens (mean) | 426 | 501 | 455 |

These are our own scenarios, so they compare versions of this project. The entity graph lifts the offline pass rate from 81.0% to 98.4% (`--no-graph` runs the same set without it). With `bge-m3` the graph changes little on small customers, because almost every fact looks a little relevant to a model whose scores are not calibrated, and the one multi-hop scenario with a dozen facts fails with or without it (see the [ROADMAP](../ROADMAP.md)). The one scenario that fails offline is a paraphrase that shares no words with the memory.

**With a real LLM.** The LLM column runs the whole suite end to end with a local LLM (`qwen3:4b` on Ollama), which extracts facts, writes the session summaries, finds facts across a session and proposes how to settle conflicts. It includes scenarios only an LLM can pass: a relation it has to invent, and a fact spread over two messages (65 scenarios in total). It needs no cloud key, but it is slow on one consumer GPU (RTX 3060): about 47 s per message, 4 h 27 min for the suite (on the CPU it is several times slower; check that the model is in VRAM).

Three scenarios do not pass in that run. `paraphrase-spending-budget` fails offline too (a paraphrase that shares no words with the memory). \*\*\* The LLM column is the v0.8.3 run, except the poison rate. In that run, in `ja-poison-shiji-wo-mushi`, the word 送金 ("send money") reached another agent (1 of 11 poison checks): the LLM had read the planted request and restated it in its own words. v0.8.4 cuts the instruction from the message before any model reads it, and a re-run of the 7 `memory_poisoning` scenarios with the LLM passed all 11 checks. One clean run is weaker evidence than the reason behind the fix: the v0.8.3 leak showed up in one run out of four. `exact-order-newer-status` failed in that run because its checks matched the exact words "has shipped" and "was cancelled", which an LLM rewrites every time; the checks now look at distinctive details (DHL, wrong address), and the scenario passes with the LLM in a separate run. The saved result (`bench/results/0.8.3-llm.json`) still has the old checks. Two scenarios depend on how a 4B model words things and pass or fail between runs: `llm-maintenance-consolidation` (the model sometimes extracts nothing, about one run in five) and `stale-trip-destination`; both passed in this run.

**On a public dataset.** `npm run bench:longmemeval` scores retrieval on [LongMemEval-S](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) (MIT, 470 questions, ~50 sessions each): is the session that holds the answer near the top? With local hashing it is in the top 4 for **53.2%** of questions and in the top 10 for **71.5%**. Preferences (20% @4) and questions that need every evidence session are the weak spots. Answer accuracy isn't measured yet.

**At scale.** A per-customer index keeps recall at p50 0.6 ms / p95 1.9 ms with 100,000 episodes (`npm run bench:scale`).

## Comparing memory systems

The same scenarios can run against another memory system, through its public API only. The first adapter is **Mem0** open source (`mem0ai` 2.2.1), run fully locally:

```bash
python3 -m venv .venv-mem0 && .venv-mem0/bin/pip install -r bench/adapters/requirements.txt "mem0ai[extras,nlp]==2.2.1"
MEM0_PYTHON=.venv-mem0/bin/python npm run bench -- --target mem0 --mem0-mode shared     # or isolated
```

How it is kept fair, and what that costs:

- **Same models.** Mem0 uses an LLM to extract memories; it gets the same local model and embeddings the hub uses in its comparison run (Ollama: Dolphin 3 Llama 3.1 8B, `bge-m3`). `qwen3:4b` could not be used: with it Mem0 extracted nothing (the model's thinking output). Override with `MEM0_LLM_MODEL`, `MEM0_EMBED_MODEL`, `MEM0_EMBED_DIMS`, `OLLAMA_URL`. Mem0's telemetry is turned off.
- **Its best configuration.** Hybrid keyword search and NLP extras installed; memories searched with a limit of 10, as the hub's top 10 facts.
- **Two configurations, both reported.** Mem0 scopes memory by user, agent and run, not per relation, so it cannot share some facts across agents while keeping others private. `shared`: every agent searches the customer's whole memory. `isolated`: each agent searches only what it wrote.
- **Not applicable, never failed.** Scenarios that need a simulated clock (`stale`, `temporal`, `asOf`) or the hub's own operations (`correct`, `forget`, `promote`), and scenarios marked `hubOnly`, are listed as not applicable. `conflict` checks look for the hub's conflict flag; Mem0 resolves a contradiction by updating, so they are not counted for it.
- **Checks match meaning, not the hub's wording.** `remembers` patterns match values or regexes that accept other phrasings ("3 days", not "no car for 3 days"). `stale` checks still match the hub's fact-line form, which makes them lenient toward other systems, not stricter.
- **What it does not show.** These are scenarios written by this project, around what it was built for. A system built for one user's long conversations is not measured where it is strong.

### Results: this hub and Mem0 (October 2026)

One run each, on the 51 scenarios all three could run, with the same local models (Dolphin 3 Llama 3.1 8B through Ollama, `bge-m3` embeddings on the CPU), `conflict` checks left out. Reproduce the table with `npm run bench:compare -- bench/results/0.8.4-llm-embed-ollama-bge-m3-cpu.json bench/results/0.8.4-mem0-shared.json bench/results/0.8.4-mem0-isolated.json`.

| 51 common scenarios | This hub | Mem0 2.2.1, shared | Mem0 2.2.1, isolated |
|---|---|---|---|
| Scenarios passed | **98.0%** (50/51) | 60.8% (31/51) | 23.5% (12/51) |
| Recall (`remembers` checks) | **98.4%** (62/63) | 82.5% (52/63) | 19.0% (12/63) |
| Leak rate | **0%** (0/10) | 100% (10/10) | **0%** (0/10) |
| Poison rate | **0%** (0/9) | 33.3% (3/9) | **0%** (0/9) |
| Stale-use rate | **0%** (0/5) | 40% (2/5) | **0%** (0/5) |
| Write / recall latency (p50) | 1.6 s / 99 ms | 3.9 s / 183 ms | 3.9 s / 186 ms |

| Category | Hub | Mem0 shared | Mem0 isolated |
|---|---|---|---|
| cross_agent | 10/10 | 8/10 | 0/10 |
| multi_hop | 14/15 | 9/15 | 1/15 |
| leakage | 4/4 | 0/4 | 3/4 |
| memory_poisoning | 6/6 | 3/6 | 0/6 |
| contradiction | 3/3 | 2/3 | 1/3 |
| arbitration | 4/4 | 3/4 | 2/4 |
| exact_match | 3/3 | 1/3 | 0/3 |
| open_schema | 5/5 | 4/5 | 5/5 |
| long_conversation | 1/1 | 1/1 | 0/1 |

How to read it:

- **The trade-off is the point.** With one memory per customer (`shared`), Mem0 shares knowledge across agents well (8 of 10 cross-agent scenarios) but every private fact reaches every agent. With one memory per agent (`isolated`), nothing leaks and nothing is shared. Mem0 scopes by user, agent and run; it has no notion of "this relation is private to the health domain", which is what these scenarios need.
- **What Mem0 got wrong on its own terms** (in this run): after "I moved to Saigon" it still returned a memory that the customer lives in Hanoi (2 scenarios); after "cancelled", then "shipped with DHL", the shipment was gone; it returned a planted account number, an exfiltration address and a planted "send money" instruction to other agents; from Vietnamese written without diacritics it recalled neither the diet nor the name.
- **What this does not show.** The scenarios were written by this project, around what it was built for: several agents, privacy between them, contradictions. Mem0 is built for one user's long-term memory and published strong results on LongMemEval and LoCoMo, which this benchmark does not measure. One run each, with an 8B model; a larger model would likely help Mem0's extraction (and this hub's).
- **Checks were fixed before these numbers, not after.** Comparing two systems exposed checks that matched this hub's wording rather than the meaning: 19 scenarios matched phrases like "no car for 3 days", and 15 Vietnamese and Japanese scenarios did not accept the English Mem0 stores ("window seat" for "cửa sổ"). Both were rewritten to match meaning in any language, and the hub was re-checked against them. Two earlier runs were discarded: Ollama's GPU `bge-m3` returned NaN embeddings, which Mem0 skips silently and this hub reports as errors.

## Metrics

| Metric | Meaning |
|---|---|
| Scenario pass rate | Scenarios where every check passed |
| Recall accuracy | `remembers` checks passed: the memory reached the agent that needed it |
| Leak rate | `private` checks that failed: private data reached an agent that must not see it. **Must be 0.** |
| Poison rate | `poison` checks that failed: planted text reached an agent. Must be 0; `--no-firewall` shows what it is without the defence |
| Stale-use rate | `stale` checks that failed: an expired or replaced fact was still in the context |
| Conflict handling | `conflict` checks passed: contradicting facts were flagged |
| Reply accuracy | `reply` checks passed (`--llm` only; offline replies come from templates) |
| Latency, prompt tokens | p50 / p95 per `say` and `recall`; mean tokens of the prompt block |

## Adding a scenario

Add one JSON file to `bench/scenarios/`. No code changes are needed.

```json
{
  "id": "cross-agent-car-unavailable",
  "category": "cross_agent",
  "lang": "en",
  "description": "Kai learns the car is in the shop; Atlas uses it without asking again.",
  "steps": [
    { "agent": "kai", "say": "My car broke down, it will be in the shop for 3 days" },
    { "advance": "1d" },
    { "agent": "atlas", "recall": "I need a flight to Da Nang next week", "expect": { "remembers": ["no car for 3 days"] } }
  ]
}
```

**Fields**
- `id`: kebab-case and unique.
- `category`: one of `cross_agent`, `stale`, `contradiction`, `leakage`, `multi_hop`, `long_conversation`, `exact_match`, `temporal`, `open_schema`, `arbitration`, `maintenance`, `memory_poisoning`.
- `hubOnly: "why"` (optional): the scenario tests this hub's own mechanism, so it is not applicable to other memory systems (`--target`).
- `requires: "llm"` (optional): the scenario needs a language model; it is skipped offline and runs with `--llm` (or `--url`, where the hub's settings decide).
- `lang`: `en`, `vi` or `ja`.

**Steps** (each step has exactly one of these):

| Step | Does |
|---|---|
| `{ "agent", "say" }` | the customer says something to an agent |
| `{ "agent", "recall" }` | an agent asks the memory for context (this is where most checks go) |
| `{ "advance": "45m" \| "6h" \| "2d" }` | moves the brain's simulated clock |
| `{ "sleep": true }` | runs a sleep cycle manually |
| `{ "mark": "before-move" }` | remembers the current (simulated) time under a name; a later `recall` can add `"asOf": "before-move"` to ask what the brain believed then |
| `{ "agent": "kai", "remember": { "facts": [{ "relation": "loyalty_tier", "value": "gold" }] } }` | a connected agent hands the brain facts through `remember` (`/v1/remember` over HTTP); relations outside the built-in ones become provisional |
| `{ "promote": { "relation": "loyalty_tier", "scope": "shared", "policy": "trust" } }` | an admin promotes a learned relation (`PUT /api/relations/:name`) |
| `{ "agent": "kai", "correct": { "relation": "lives_in", "value": "Saigon" } }` | an agent corrects a fact it can see (`/v1/correct`); `wrongValue` picks one value, no `value` just drops it |
| `{ "agent": "sage", "forget": { "relation": "allergic_to" } }` | an agent forgets on the customer's request (`/v1/forget`); add `value` to forget one value only |

Categories also include `exact_match` (order numbers, model names), `temporal` (looking back with `asOf`), `open_schema` (relations outside the built-in ones, and that they stay private until promoted) `arbitration` (what happens when two agents write different values: write policies, trust ties, customer updates) and `maintenance` (agents correcting and forgetting facts, including that a forgotten value is gone when looking back and that another domain cannot forget a private fact) and `memory_poisoning` (instructions planted in a message, a summary or a shared relation, which must not reach another agent while the real content stays findable; one scenario checks ordinary "always"/"never" preferences are not blocked). A `stale` check on a value that is still in the conversation history should match the fact line (`"/lives in:? hanoi/i"`), not the bare word. Agents are `mia` (personal), `kai` (repair), `atlas` (travel), `sage` (health, private), `penny` (finance), `nova` (shopping). Add `"customer": "<id>"` to a step to use more than one customer; by default every scenario has its own customer.

Automatic sleep runs after every step, as it does in production (idle and pressure triggers; the nightly trigger is off because it depends on wall-clock time).

**Checks** (in `expect`):

| Check | Allowed on | Passes when |
|---|---|---|
| `remembers: [...]` | `recall` | each text appears in the returned memories |
| `private: [...]` | `recall` | none of the texts appears in the memories or the prompt block |
| `stale: [...]` | `recall` | none of the texts appears in the memories |
| `conflict: [...]` | `recall` | each text appears in a memory flagged as conflicting |
| `poison: [...]` | `recall` | none of the texts appears in the memories or in the prompt block (planted instructions that must not reach the agent) |
| `order: [[a, b], ...]` | `recall` | `a` appears in a memory above the first one containing `b` (or `b` is absent) |
| `reply: { includes, excludes }` | `say` | the reply includes / excludes the texts (`--llm` only) |

Texts match case-insensitively as substrings. Write `"/pattern/flags"` for a regex.

**Writing good expectations**
- Describe what a **good** memory should do, not what the current version does. A scenario that fails today is useful: it shows where the memory is weak.
- Match on values ("vegetarian", "Da Nang") rather than labels where you can, so scenarios survive changes to how facts are rendered. `stale` checks are the exception: they often need the fact's form (`"/lives in:? hanoi/i"`), because the old value may legitimately still appear in a past conversation.
- Real failures from your own multi-agent systems make the best scenarios.

Run `npm test`: it validates every scenario file. `npm run bench` stops with a list of errors (file and step) if a file is invalid.

## How it works

Each scenario runs against a **target** with a small interface (`say`, `recall`, `remember`, `correct`, `forget`, `promote`, `advance`, `sleep`). Scoring only uses what a public API exposes: the `recall` payload (`memories[]`, `promptBlock`) and replies. The same scenarios can therefore run over HTTP later ([#15](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/15)) and keep working when the memory core changes.

**Benchmarking a running hub** (`--url`, [lib/targets/http.mjs](lib/targets/http.mjs)) uses only its REST APIs, so it scores exactly what you deployed: a Docker container, a hub with its own LLM and embedding settings. Each scenario gets its own customer, and each scenario agent becomes a temporary connected agent with the same domain, deleted afterwards; built-in agents and their keys are never touched. `advance` moves the hub's simulated clock, which is global, so **point it at a test hub, not production**. Run against the same configuration, it gives the same numbers as the in-process target.

The in-process target ([lib/targets/inprocess.mjs](lib/targets/inprocess.mjs)) creates a fresh brain for every scenario. It also returns RAS diagnostics, so a failed check can say why a memory was excluded. Diagnostics explain results; they are never scored.

Background and design discussion: [#12](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/12).
