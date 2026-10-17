"""Agent Brain Hub: Python client for connected (external) agents.

Standard library only (Python 3.8+). The same calls as sdk/brain-client.js.

    from brain_client import BrainClient

    brain = BrainClient(url="http://localhost:4317", api_key=os.environ["BRAIN_API_KEY"])
    ctx = brain.recall(customer_id="kh-001", text=user_message, lang="en")
    reply = my_own_llm(ctx["promptBlock"], user_message)
    brain.remember(trace_id=ctx["traceId"], reply=reply)
"""
import json
import urllib.error
import urllib.parse
import urllib.request


class BrainError(Exception):
    """The hub answered with an error. `status` is the HTTP status (404, 401, ...)."""

    def __init__(self, status, message):
        super().__init__(f"{status} {message}")
        self.status = status
        self.message = message


class BrainClient:
    def __init__(self, url="http://localhost:4317", api_key=None, timeout=30):
        if not api_key:
            raise ValueError("BrainClient: api_key is required (create a connected agent in the hub UI)")
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _call(self, method, path, body=None):
        # Like the JS client, keys whose value is None are left out of the request.
        data = json.dumps({k: v for k, v in body.items() if v is not None}).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            try:
                message = json.loads(e.read().decode()).get("error") or e.reason
            except (ValueError, AttributeError):
                message = e.reason
            raise BrainError(e.code, message) from None

    def me(self):
        """Who am I (agent id, domain, permissions)."""
        return self._call("GET", "/v1/me")

    def recall(self, customer_id, text, lang="vi", include_steps=False, as_of=None):
        """Memory context for a user message. Put result["promptBlock"] in your own system prompt.

        as_of (ms since the epoch, or an ISO date) asks what the brain believed then; it is read-only.
        """
        return self._call("POST", "/v1/recall", {"customerId": customer_id, "text": text, "lang": lang, "includeSteps": include_steps, "asOf": as_of})

    def remember(self, customer_id=None, trace_id=None, user_text=None, reply=None, facts=None, outcome=None, lang="vi"):
        """Hand the turn back so the brain can learn from it.

        Pass trace_id from recall(), or user_text if you skipped recall(). facts is
        [{"relation": ..., "value": ...}] (any relation name; a new one starts private
        to your domain until an admin promotes it); outcome is {"actionId": ..., "accepted": ...}.
        """
        return self._call("POST", "/v1/remember", {"customerId": customer_id, "traceId": trace_id, "userText": user_text, "reply": reply, "facts": facts, "outcome": outcome, "lang": lang})

    def chat(self, customer_id, text, lang="vi"):
        """Let the brain answer with its own LLM (native mode over the API)."""
        return self._call("POST", "/v1/chat", {"customerId": customer_id, "text": text, "lang": lang})

    def feedback(self, trace_id, action_id, accepted, lang="vi"):
        """Report whether the customer accepted a suggested action."""
        return self._call("POST", "/v1/feedback", {"traceId": trace_id, "actionId": action_id, "accepted": accepted, "lang": lang})

    def correct(self, customer_id, relation, wrong_value=None, value=None, reason=None, lang="vi"):
        """Correct a fact this agent can see: the wrong value is kept as history and replaced by `value`
        if given. wrong_value picks one value of a multi-valued relation. Raises BrainError(404) when
        there is nothing visible to correct."""
        return self._call("POST", "/v1/correct", {"customerId": customer_id, "relation": relation, "wrongValue": wrong_value, "value": value, "reason": reason, "lang": lang})

    def forget(self, customer_id, relation, value=None):
        """Forget on the customer's request: deletes the relation's facts this agent can see (or only
        `value`), with their history, and scrubs the value from what this agent can see (word for word:
        a summary an LLM wrote in other words is not caught). Returns {"removedFacts", "scrubbed"}."""
        return self._call("POST", "/v1/forget", {"customerId": customer_id, "relation": relation, "value": value})

    def profile(self, customer_id, lang="vi"):
        """Facts about a customer that this agent is allowed to see."""
        return self._call("GET", f"/v1/profile?customerId={urllib.parse.quote(customer_id)}&lang={lang}")
