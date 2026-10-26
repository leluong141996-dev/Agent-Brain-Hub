"""A software team on one shared brain: Architect, Coder and QA agents.

QA finds a bug and records it as a known pitfall; the Architect records a
convention. Later the Coder asks the brain before writing code and gets both,
with who recorded them and when. The "customer" here is the repository.

Run the hub first (`docker compose up -d` or `npm start`), then:

    python examples/dev_team.py

Open http://localhost:4317 while it runs to watch the brain regions light up.
Standard library only; set BRAIN_ADMIN_TOKEN if the hub has one.
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))
from brain_client import BrainClient  # noqa: E402

URL = os.environ.get("BRAIN_URL", "http://localhost:4317")
REPO = "repo:shop-api"


def create_agent(name):
    """Admin API: create a connected agent in the engineering domain, return its key."""
    req = urllib.request.Request(
        f"{URL}/api/agents",
        data=json.dumps({"name": name, "domain": "engineering", "kind": "external"}).encode(),
        headers={"content-type": "application/json", "x-admin-token": os.environ.get("BRAIN_ADMIN_TOKEN", "")},
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        return json.load(res)["apiKey"]


architect = BrainClient(url=URL, api_key=create_agent("Architect"))
coder = BrainClient(url=URL, api_key=create_agent("Coder"))
qa = BrainClient(url=URL, api_key=create_agent("QA"))

# 1. The architect records a decision; QA records what broke.
architect.remember(customer_id=REPO, lang="en", facts=[
    {"relation": "convention", "value": "store every timestamp in UTC; convert only in the UI"},
])
qa.remember(customer_id=REPO, lang="en", facts=[
    {"relation": "known_pitfall", "value": "parseDate breaks on DST changes; test with Europe/Berlin 2026-03-29 02:30"},
])

# 2. Days later, the coder is asked to touch the same code. It asks the brain first.
ctx = coder.recall(customer_id=REPO, text="Implement parseDate for order timestamps", lang="en")
print("What the coder gets before writing a line:\n")
for m in ctx["memories"]:
    print(" -", m["text"])
print("\nPut ctx['promptBlock'] in the coder's system prompt; it carries the same facts with their source and age.")
