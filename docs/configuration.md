[← README](../README.md)

# Configuration and deployment

## LLM: pick a provider in the UI

Open **Settings → Language model**. There you:
1. choose a provider;
2. enter the API key (it is stored only on the server, in `data/settings.json` with mode 0600, and never sent back to the browser);
3. click **Fetch models** to get model names straight from the provider, then **Test connection** and **Save & apply**.

Changes take effect immediately, with no restart.

| Provider | Protocol | Default base URL | Key environment variable |
|---|---|---|---|
| **Claude** (Anthropic) | Official Anthropic SDK | — | `ANTHROPIC_API_KEY` |
| **GPT** (OpenAI) | OpenAI Chat Completions | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| **Gemini** (Google) | OpenAI-compatible endpoint | `https://generativelanguage.googleapis.com/v1beta/openai` | `GEMINI_API_KEY` |
| **DeepSeek** | OpenAI-compatible | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| **Mistral** | OpenAI-compatible | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| **Groq** | OpenAI-compatible | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| **Grok** (xAI) | OpenAI-compatible | `https://api.x.ai/v1` | `XAI_API_KEY` |
| **OpenRouter** (hundreds of models) | OpenAI-compatible | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| **Together** | OpenAI-compatible | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` |
| **Ollama / vLLM / LM Studio** (local) | OpenAI-compatible | `localhost:11434` / `:8000` / `:1234` | not needed |
| **Custom** | Any OpenAI-compatible endpoint | your own | `BRAIN_LLM_API_KEY` |
| **Offline** | Rules + templates | — | — |

- The **main model** answers customers. The optional **utility model** handles fact extraction, session summaries and reflection; pick a cheap, fast one to save cost.
- **Adapts to each provider:** when a parameter is rejected (HTTP 400/422), the client adjusts and retries, and remembers it for next time:
  - `max_tokens` → `max_completion_tokens` (GPT reasoning models);
  - drop `temperature`;
  - drop JSON mode;
  - drop parameters specific to local servers.
- **Never goes down:** if the LLM fails, the brain falls back to rules + templates.
- **Environment variables** are only defaults until something is saved in the UI:
  - `BRAIN_LLM_PROVIDER`, `BRAIN_LLM_MODEL`, `BRAIN_LLM_BASE_URL`, `BRAIN_LLM_API_KEY`;
  - or just set one provider's key, for example `OPENAI_API_KEY`, and that provider is selected automatically;
  - `BRAIN_OFFLINE=1` disables all LLM calls;
  - `BRAIN_SETTINGS` changes the settings file path.

Run a local model on vLLM (Qwen3-4B fits a 12 GB GPU): `scripts/start-vllm.sh` (or `docker compose --profile vllm up -d`), then pick **vLLM** in Settings.

Notes on vLLM:
- The `latest` image needs NVIDIA driver ≥ 575. Override with `VLLM_IMAGE=…`.
- JSON requests use `temperature 0.1` to avoid a CUDA error in vLLM 0.10.2 when requests are batched together.

## Storage: SQLite

The whole brain lives in **one SQLite file**, `data/brain.db` (WAL mode), created automatically on first run.

| Table | Contents |
|---|---|
| `facts` | Semantic memory. Indexed columns `customer_id`, `relation`, `status`, `scope`, `owner_domain`, `source_agent_id`, `valid_until`, plus `embedding` (Float32 BLOB). |
| `episodes` | Episodic memory. Columns `customer_id`, `kind`, `scope`, `agent_id`, `created_at`, `expires_at` and `embedding`. |
| `audit` | Append-only audit log, **never truncated**. The value dashboard is computed in SQL over the full history. |
| `agents`, `customers`, `working`, `skills`, `patterns`, `bandit`, `insights`, `traces` | The rest of the brain, one JSON document per row. |
| `meta` | Schema version, simulated clock, id counters, usage stats. |

**How it works:**
- On startup the state is loaded into memory, which acts as a cache.
- After each change (batched over 300 ms), the server **writes only the rows that changed**, in one transaction.
- On SIGINT/SIGTERM the server flushes pending writes and closes the database cleanly.
- With 20,000 episodes: the first write takes about 0.2 s, each chat turn afterwards writes about 10 rows, and reloading on startup takes about 0.2 s.

You can **query it directly**, for example:
```bash
sqlite3 data/brain.db "SELECT relation, json_extract(data,'$.value'), scope FROM facts WHERE customer_id='kh-001'"
sqlite3 data/brain.db "SELECT source_agent_id, agent_id, COUNT(*) FROM audit WHERE op='read' GROUP BY 1,2"
```

**Backup:** `sqlite3 data/brain.db ".backup backup.db"` (safe while the server is running). Change the path with `BRAIN_DB`.

**Upgrading from older versions:** if `data/brain.json` (schema v3) exists, it is imported into SQLite on first run and the original file is renamed to `brain.imported.bak.json`. Change the legacy JSON path with `BRAIN_DATA`.

**Current limits:**
- Only **one server process** can run, because state is cached in memory.
- Vector search is still a linear scan in memory.

Both go away with the move to PostgreSQL + pgvector (see the [roadmap](../ROADMAP.md)).

## Data & security when deploying

- All memory lives in `data/brain.db` (with Docker: the `brain-data` volume, mounted at `/app/data`); the LLM configuration and API keys live in `data/settings.json` (mode 0600). The whole `data/` folder is gitignored. **Don't commit it.**
- Without `BRAIN_ADMIN_TOKEN`, the admin UI and `/api/*` are **open to anyone who can reach the port**. Outside your own machine, set it (the UI asks for the token once) and put the server behind a reverse proxy with HTTPS.
- External agents can only use `/v1/*` with their own API key, and their reads and writes are limited by that agent's permissions.
