# Memory benchmark

`npm run bench` scores the shared memory as a whole: does one agent's knowledge reach the others, do expired facts stay out, are contradictions handled, does private data stay private? It runs offline and deterministically in about a second, so every change can show before/after numbers.

```bash
npm run bench                                         # offline, prints the report
npm run bench -- --filter leakage                     # one category, or one scenario id
npm run bench -- --compare bench/results/0.2.0.json   # adds a delta column
npm run bench -- --llm                                # with the configured LLM (UI settings or BRAIN_LLM_* env)
npm run bench -- --save                               # writes bench/results/<version>.json
npm run bench -- --gate bench/results/0.3.0.json      # what CI runs: exit 1 if a quality metric got worse
```

**The CI gate** fails a PR if scenario pass rate, recall accuracy, stale-use rate, conflict handling or reply accuracy gets worse than the committed baseline, or if anything leaks. Latency and prompt tokens are reported but not gated. If a change is meant to move a number (for example, a new scenario that the current memory fails), re-save the baseline with `--save` in the same PR and say why in the description.

## Metrics

| Metric | Meaning |
|---|---|
| Scenario pass rate | Scenarios where every check passed |
| Recall accuracy | `remembers` checks passed: the memory reached the agent that needed it |
| Leak rate | `private` checks that failed: private data reached an agent that must not see it. **Must be 0.** |
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
- `category`: one of `cross_agent`, `stale`, `contradiction`, `leakage`, `multi_hop`, `long_conversation`.
- `lang`: `en`, `vi` or `ja`.

**Steps** (each step has exactly one of these):

| Step | Does |
|---|---|
| `{ "agent", "say" }` | the customer says something to an agent |
| `{ "agent", "recall" }` | an agent asks the memory for context (this is where most checks go) |
| `{ "advance": "45m" \| "6h" \| "2d" }` | moves the brain's simulated clock |
| `{ "sleep": true }` | runs a sleep cycle manually |

Agents are `mia` (personal), `kai` (repair), `atlas` (travel), `sage` (health, private), `penny` (finance), `nova` (shopping). Add `"customer": "<id>"` to a step to use more than one customer; by default every scenario has its own customer.

Automatic sleep runs after every step, as it does in production (idle and pressure triggers; the nightly trigger is off because it depends on wall-clock time).

**Checks** (in `expect`):

| Check | Allowed on | Passes when |
|---|---|---|
| `remembers: [...]` | `recall` | each text appears in the returned memories |
| `private: [...]` | `recall` | none of the texts appears in the memories or the prompt block |
| `stale: [...]` | `recall` | none of the texts appears in the memories |
| `conflict: [...]` | `recall` | each text appears in a memory flagged as conflicting |
| `reply: { includes, excludes }` | `say` | the reply includes / excludes the texts (`--llm` only) |

Texts match case-insensitively as substrings. Write `"/pattern/flags"` for a regex.

**Writing good expectations**
- Describe what a **good** memory should do, not what the current version does. A scenario that fails today is useful: it shows where the memory is weak.
- Match on values ("vegetarian", "Da Nang") rather than labels where you can, so scenarios survive changes to how facts are rendered. `stale` checks are the exception: they often need the fact's form (`"/lives in:? hanoi/i"`), because the old value may legitimately still appear in a past conversation.
- Real failures from your own multi-agent systems make the best scenarios.

Run `npm test`: it validates every scenario file. `npm run bench` stops with a list of errors (file and step) if a file is invalid.

## How it works

Each scenario runs against a **target** with a small interface (`say`, `recall`, `advance`, `sleep`). Scoring only uses what a public API exposes: the `recall` payload (`memories[]`, `promptBlock`) and replies. The same scenarios can therefore run over HTTP later ([#15](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/15)) and keep working when the memory core changes.

The in-process target ([lib/targets/inprocess.mjs](lib/targets/inprocess.mjs)) creates a fresh brain for every scenario. It also returns RAS diagnostics, so a failed check can say why a memory was excluded. Diagnostics explain results; they are never scored.

Background and design discussion: [#12](https://github.com/leluong141996-dev/Agent-Brain-Hub/issues/12).
