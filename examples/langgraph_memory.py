"""Shared memory for a LangGraph graph, in two nodes.

`recall` puts what every agent knows about this user into the state before
your model runs; `remember` hands the turn back so the hub can learn from it.
The hub does the rest (fact extraction, contradictions, privacy, sleep).

    pip install langgraph
    BRAIN_API_KEY=abk_... python examples/langgraph_memory.py

Create the key in the hub UI (Agents → connected agent) or with POST /api/agents.
Swap `my_llm` for your model; it is a stub so the example runs without one.
"""
import os
import sys
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))
from brain_client import BrainClient  # noqa: E402

brain = BrainClient(url=os.environ.get("BRAIN_URL", "http://localhost:4317"), api_key=os.environ["BRAIN_API_KEY"])


class State(TypedDict, total=False):
    user_id: str
    message: str
    memory: str  # the hub's promptBlock
    trace_id: str
    reply: str


def recall(state: State) -> State:
    ctx = brain.recall(customer_id=state["user_id"], text=state["message"], lang="en")
    return {"memory": ctx["promptBlock"], "trace_id": ctx["traceId"]}


def my_llm(system: str, user: str) -> str:
    known = [line for line in system.splitlines() if line.startswith("- ")]
    return f"(stub) {len(known)} memories in context. You said: {user}"


def answer(state: State) -> State:
    return {"reply": my_llm(system=state["memory"], user=state["message"])}


def remember(state: State) -> State:
    brain.remember(trace_id=state["trace_id"], reply=state["reply"], lang="en")
    return {}


graph = StateGraph(State)
graph.add_node("recall", recall)
graph.add_node("answer", answer)
graph.add_node("remember", remember)
graph.add_edge(START, "recall")
graph.add_edge("recall", "answer")
graph.add_edge("answer", "remember")
graph.add_edge("remember", END)
app = graph.compile()

if __name__ == "__main__":
    for text in ["I'm vegetarian and I live in Hanoi", "Book me a dinner place for Friday"]:
        out = app.invoke({"user_id": "user-42", "message": text})
        print(out["reply"])
