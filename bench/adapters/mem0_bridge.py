"""Bridge between the benchmark (Node) and Mem0 open source (Python).

One JSON object per line on stdin, one answer per line on stdout:
  {"op": "add", "user_id", "agent_id", "text", "infer"}  -> {"ok": true, "results": [...]}
  {"op": "search", "user_id", "agent_id"?, "query", "limit"} -> {"ok": true, "results": [...]}
Configuration (environment): MEM0_LLM_MODEL, MEM0_EMBED_MODEL, MEM0_EMBED_DIMS,
OLLAMA_URL. Everything runs locally: Ollama for the LLM and embeddings, an
on-disk Qdrant in a temporary directory for the vectors.
"""
import json
import os
import sys
import tempfile
import traceback

os.environ.setdefault("MEM0_TELEMETRY", "False")  # the benchmark runs locally; no usage events leave the machine

from mem0 import Memory

ollama = os.environ.get("OLLAMA_URL", "http://localhost:11434")
tmp = tempfile.mkdtemp(prefix="mem0-bench-")
config = {
    "llm": {"provider": "ollama", "config": {"model": os.environ.get("MEM0_LLM_MODEL", "hf.co/cognitivecomputations/Dolphin3.0-Llama3.1-8B-GGUF:Q4_0"), "ollama_base_url": ollama, "temperature": 0}},
    "embedder": {"provider": "ollama", "config": {"model": os.environ.get("MEM0_EMBED_MODEL", "bge-m3"), "ollama_base_url": ollama}},
    "vector_store": {"provider": "qdrant", "config": {"path": os.path.join(tmp, "qdrant"), "collection_name": "bench", "embedding_model_dims": int(os.environ.get("MEM0_EMBED_DIMS", "1024")), "on_disk": True}},
    "history_db_path": os.path.join(tmp, "history.db"),
}
memory = Memory.from_config(config)
print(json.dumps({"ok": True, "ready": True, "llm": config["llm"]["config"]["model"], "embedder": config["embedder"]["config"]["model"]}), flush=True)

for line in sys.stdin:
    try:
        req = json.loads(line)
        if req["op"] == "add":
            r = memory.add([{"role": "user", "content": req["text"]}], user_id=req["user_id"], agent_id=req.get("agent_id"), infer=req.get("infer", True))
        elif req["op"] == "search":
            filters = {"user_id": req["user_id"]}
            if req.get("agent_id"):
                filters["agent_id"] = req["agent_id"]
            r = memory.search(req["query"], filters=filters, limit=req.get("limit", 10))
        else:
            raise ValueError(f"unknown op {req['op']}")
        print(json.dumps({"ok": True, "results": r.get("results", [])}), flush=True)
    except Exception as e:  # report and keep serving
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-800:]}), flush=True)
