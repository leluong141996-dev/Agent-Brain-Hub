# Security policy

## Supported versions

Agent Brain Hub is young, so only the latest release gets security fixes.

| Version | Supported |
|---|---|
| 0.1.x (latest) | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting instead: open the [Security tab](https://github.com/leluong141996-dev/Agent-Brain-Hub/security) and click **Report a vulnerability**. Only the maintainer can see the report.

Please include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within a few days. Once a fix is released you'll be credited in the advisory, unless you'd rather not be.

## What counts

A shared memory for many agents has to keep each agent inside its permissions. These are the issues that matter most:

- an agent reading memories it shouldn't see (`private` scope, another domain, `readShared: false`);
- an agent writing when its `write` permission is off, or overwriting facts owned by another domain;
- PII that should be redacted by the brainstem but is stored or sent to an LLM;
- API keys or LLM provider keys exposed through the API, the UI, logs or the audit trail;
- bypassing `BRAIN_ADMIN_TOKEN` on the admin API (`/api/*`).

Running the hub on a public port without `BRAIN_ADMIN_TOKEN` is a configuration choice, not a vulnerability: see *Data & security when deploying* in the README.
