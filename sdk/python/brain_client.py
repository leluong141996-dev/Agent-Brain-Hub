"""Python client for Agent Brain Hub.

Example:

    from brain_client import BrainClient

    brain = BrainClient(
        url="http://localhost:4317",
        api_key="your-api-key",
    )

    brain.remember(
        customer_id="user-123",
        user_text="My favorite color is blue.",
        reply="Got it!",
    )

    context = brain.recall(
        customer_id="user-123",
        text="What is my favorite color?",
    )

    print(context)
"""

import json
import urllib.error
import urllib.parse
import urllib.request


class BrainError(Exception):
    """Error returned by the Agent Brain API."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class BrainClient:
    def __init__(
        self,
        url="http://localhost:4317",
        api_key=None,
        timeout_ms=30000,
    ):
        if not api_key:
            raise ValueError(
                "BrainClient: api_key is required "
                "(create a connected agent in the hub UI)"
            )

        self.url = url.rstrip("/")
        self.api_key = api_key
        self.timeout_ms = timeout_ms

    def _call(self, method, path, body=None):
        headers = {
            "Authorization": f"Bearer {self.api_key}",
        }

        data = None

        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")

        request = urllib.request.Request(
            self.url + path,
            data=data,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=self.timeout_ms / 1000,
            ) as response:
                response_data = response.read().decode("utf-8")

                if not response_data:
                    return {}

                if not response_data:
                    return {}

                try:
                    return json.loads(response_data)
                except json.JSONDecodeError:
                    return {}

        except urllib.error.HTTPError as error:
            try:
                error_data = json.loads(
                    error.read().decode("utf-8")
                )
                message = error_data.get("error", error.reason)
            except (json.JSONDecodeError, UnicodeDecodeError):
                message = error.reason

            raise BrainError(error.code, message) from error
    def me(self):
        """Return the agent's identity, domain, and permissions."""
        return self._call("GET", "/v1/me")

    def recall(
        self,
        customer_id,
        text,
        lang="vi",
        include_steps=False,
    ):
        """Retrieve memory context for a user message."""
        body = {
            "customerId": customer_id,
            "text": text,
            "lang": lang,
            "includeSteps": include_steps,
        }

        return self._call("POST", "/v1/recall", body)

    def remember(
        self,
        customer_id,
        trace_id=None,
        user_text=None,
        reply=None,
        facts=None,
        outcome=None,
        lang="vi",
    ):
        """Send a conversation turn back to the brain."""
        body = {
            "customerId": customer_id,
            "traceId": trace_id,
            "userText": user_text,
            "reply": reply,
            "facts": facts,
            "outcome": outcome,
            "lang": lang,
        }

        return self._call("POST", "/v1/remember", body)

    def chat(self, customer_id, text, lang="vi"):
        """Let the brain answer using its native LLM."""
        body = {
            "customerId": customer_id,
            "text": text,
            "lang": lang,
        }

        return self._call("POST", "/v1/chat", body)

    def feedback(
        self,
        trace_id,
        action_id,
        accepted,
        lang="vi",
    ):
        """Report whether a suggested action was accepted."""
        body = {
            "traceId": trace_id,
            "actionId": action_id,
            "accepted": accepted,
            "lang": lang,
        }

        return self._call("POST", "/v1/feedback", body)

    def profile(self, customer_id, lang="vi"):
        """Return facts about a customer the agent can access."""
        query = urllib.parse.urlencode(
            {
                "customerId": customer_id,
                "lang": lang,
            }
        )

        return self._call("GET", f"/v1/profile?{query}")