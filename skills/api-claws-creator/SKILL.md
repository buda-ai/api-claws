---
name: api-claws-creator
description: Build an agent harness on top of Buda API Claws — the hosted Agent API at /api/v1 that provides the runtime, durable Drive memory, sessions, and tenant isolation, so you only build the surface your users touch. Use when someone wants to add an AI agent to a device, mini program, browser extension, SaaS product, support widget, or internal tool and asks how to start, how to structure it, or how to wire sessions, memory, tenancy, or a frontend-safe chat surface. Do not use for questions about the Buda consumer app that do not involve building an integration.
---

# API Claws Creator

Build a working **agent harness** on API Claws in one sitting.

A harness is everything that surrounds a model so it behaves like a coworker instead of a
text completion: a runtime that can actually do work, memory that survives the conversation,
one isolated context per end user, and a boundary between customers. Building all of that is
weeks of work. API Claws hosts it, so the harness you write is the thin part — the part that
knows your users, your product, and your surface.

## What you build vs. what API Claws hosts

| Harness part | Who owns it | Where it lives |
| --- | --- | --- |
| Model access, provider switching, keys | API Claws | — |
| Agent runtime, tool sandboxing | API Claws | — |
| Durable memory / knowledge base | API Claws | Drive (`/drive/files`) |
| Session and context management | API Claws | Sessions (`/sessions`) |
| Tenant isolation | API Claws | Spaces (`/spaces`) |
| Wake/sleep of idle agents | API Claws | — |
| **Identity mapping** — your user/device → a session | **You** | Your DB |
| **Turn loop** — send, poll, render | **You** | Your backend |
| **Knowledge writes** — what your product learns | **You** | Your backend → Drive |
| **Surface** — UI, voice, chat, webhook | **You** | Your frontend/device |
| **Credential boundary** — who may hold the `sk_` key | **You** | Backend only |

The four rows marked **You** are the entire job. Everything below is how to do them.

## Before you start

- An API key from **Settings → API Keys** in the Buda dashboard. It is shown once, prefixed `sk_`.
- **API Claws enabled** in the Developer Center (`https://buda.im/developer`). That creates your
  **Developer Space** — the Space your API agents run in, which holds the API Claws credit balance.
  It starts with **no free credits**: top it up, or every run fails with `API_CLAW_CREDITS_EXHAUSTED`.
- Base URL: `https://buda.im/api/v1`. Bearer auth on every call.
- Confirm the key works before writing anything else:

```bash
curl -s https://buda.im/api/v1/users/me -H "Authorization: Bearer $BUDA_API_KEY"
```

A `401` means the key is wrong or expired. Fix that first — every later failure looks the same.

Never let the `sk_` key reach a browser, mobile app, mini program, or device firmware.
Those surfaces use short-lived embed tokens (Step 5).

## Step 1 — Pick the tenancy shape first

This is the one decision that is expensive to change later, because Spaces are the billing and
isolation boundary. Decide what "one customer" means in your product, then map it:

| You are building | One Space per | One Agent per |
| --- | --- | --- |
| Device fleet (watch, speaker, IoT) | Customer, fleet, or premium tier | Device model or assistant role |
| Mini program / extension | Merchant, course, or end-user account | Business function (support, tutor, shopping) |
| SaaS copilot | Customer tenant | Workflow (onboarding, reporting, support) |
| Support widget | Brand or company | Support queue |
| Internal tool | Department or project | Job (ops, sales, research) |

Rules of thumb that keep you out of trouble:

- Anything that must **never** see another party's data gets its own Space.
- Anything that is just a different *role* is another Agent inside the same Space.
- Anything that is just a different *conversation* is another Session. Do not create a Space per
  end user unless each end user really is a paying tenant — you buy Spaces, they are not free.

**Start in your Developer Space.** API Claws has its own Space — the Developer Space the
Developer Center creates — with its own credit balance. It is separate from your personal
workspace and has nothing to do with that workspace's plan. Build and prove the harness there with
one Agent per role, then add per-customer Spaces once the isolation model is settled.

Write the decision down in the repo before coding. It becomes your provisioning logic.

## Step 2 — Find your Developer Space, then provision an Agent

```bash
# Your Spaces. The one with "kind": "developer" is where API agents run and credits live.
curl -s https://buda.im/api/v1/spaces -H "Authorization: Bearer $BUDA_API_KEY"
# -> { "spaces": [ { "id": "<spaceId>", "name": "API Claws", "kind": "developer", ... }, ... ] }

# Agent inside it
curl -s -X POST https://buda.im/api/v1/api-agents \
  -H "Authorization: Bearer $BUDA_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "spaceId": "<spaceId>",
    "name": "Watch Assistant",
    "instructions": "You are a smartwatch assistant. Use Drive files as the source of truth. Keep replies short enough for a small screen."
  }'
# -> { "id": "<agentId>", "spaceId": "...", "driveId": "...", "status": "idle", ... }
```

No `"kind": "developer"` Space in the list means API Claws is not enabled yet — do that in the
Developer Center; the API cannot create it for you.

Persist `spaceId` and `agentId` in your own database, keyed by whatever your product calls a
customer. Provisioning is idempotent from your side only if you check first — list before you
create, or you will grow a duplicate Agent (or, on a paid plan, a duplicate Space via
`POST /spaces`) on every retry.

`instructions` is the agent's standing role. It is durable; it is not the place for per-turn
context. Per-turn context goes in the message; durable facts go in Drive.

## Step 3 — Load durable knowledge into Drive

Drive is the agent's long-term memory. Prefer it over stuffing everything into every prompt:
files persist across sessions, cost nothing to re-send, and can be updated without redeploying.

```bash
curl -s -X PUT https://buda.im/api/v1/api-agents/<agentId>/drive/files \
  -H "Authorization: Bearer $BUDA_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "path": "manuals/reset-device.md",
    "mimeType": "text/markdown",
    "content": "# Resetting the device\n\nHold the crown for 8 seconds, then confirm on screen."
  }'
```

What belongs in Drive: product manuals, policies, FAQs, playbooks, SOPs, per-customer settings,
durable user state ("this customer is on the enterprise plan, their device is model X").

What does *not*: the current question, a one-off greeting, anything that changes every turn,
and anything you would not want retained.

Organize by path (`manuals/`, `policies/`, `state/<userId>.md`) — you will be updating these
files programmatically later, and flat naming gets unmanageable fast.

**Drive is not pasted into the prompt.** The model receives the user's message; the agent reads
Drive files with its own file tools when it decides to. So the `instructions` must say that Drive
is the source of truth and roughly where to look ("product answers are in `manuals/`"). An agent
that is never told to look answers from general knowledge while your manual sits unread.

## Step 4 — Run a turn

A turn is: create or continue a session, then poll until it settles. The run is asynchronous —
the POST returns `202` immediately with a session, not with the answer.

```bash
# First turn — creates the session
curl -s -X POST https://buda.im/api/v1/api-agents/<agentId>/sessions \
  -H "Authorization: Bearer $BUDA_API_KEY" -H "Content-Type: application/json" \
  -d '{"message":"How do I reset my device?","mode":"chat"}'
# -> { "session": { "id": "<sessionId>", "status": "pending", ... }, "run": { "started": true, "statusUrl": "..." } }

# Later turns — same session, so the agent keeps context
curl -s -X POST https://buda.im/api/v1/api-agents/<agentId>/sessions/<sessionId>/messages \
  -H "Authorization: Bearer $BUDA_API_KEY" -H "Content-Type: application/json" \
  -d '{"message":"It did not work.","mode":"chat"}'

# Poll until it settles
curl -s https://buda.im/api/v1/api-agents/<agentId>/sessions/<sessionId> \
  -H "Authorization: Bearer $BUDA_API_KEY"
# -> { "session": { "status": ..., "error": null }, "messages": [...], "run": { "status", "streamUrl", "cancelUrl" } }
```

Session status is one of `pending`, `in_progress`, `waiting_for_input`, `completed`, `failed`,
`cancelled`. **Stop polling on the last four** — `waiting_for_input` is a settled state that
means the agent asked *you* something, not a failure, and code that only waits for `completed`
will hang there forever.

A `failed` session carries the reason in `session.error` as `{ code, message }`. The first one
you will meet is `API_CLAW_CREDITS_EXHAUSTED` — the Developer Space credits are used up and the run
was refused before it started. Its message links to the Developer Center page where the balance is
topped up, so show it as-is to whoever owns the account; do not retry in a loop.

`mode` picks the behavior: `chat` for conversation, `agent` for tool-using work, `thinking` for
harder reasoning, `build-app` for app generation. Start with `chat`.

Poll with backoff (for example 1s, then widening to ~3s, capped by a deadline). Do not poll in a
tight loop, and always have a timeout — then surface the timeout to the user as "still working"
rather than as an error, because the run continues server-side.

**Store the mapping `your-user-id → sessionId` in your database.** This is the single most
important line of harness code you will write: it is what makes the agent remember this user
across turns instead of meeting a stranger every time.

## Step 5 — Wire your surface

Pick by who is calling, not by what looks convenient:

**Your backend calls Buda (server-to-server).** Use the `sk_` key directly. This is the default
for SaaS backends, device backends, and internal tools.

**A browser needs a chat UI and you want one for free.** Mint a short-lived hosted iframe URL
from your backend and iframe exactly what it returns:

```bash
curl -s -X POST https://buda.im/api/v1/spaces/<spaceId>/agents/<agentId>/embed-urls \
  -H "Authorization: Bearer $BUDA_API_KEY" -H "Content-Type: application/json" \
  -d '{"externalUserId":"customer-123","displayName":"Kelly","ttlSeconds":3600,"mode":"chat"}'
# -> { "embedUrl": "https://buda.im/embed/api-claw/<sessionId>#token=...", "sessionId": "...", "expiresAt": "..." }
```

The token rides in the URL hash, so it is never sent to a server as part of the page request.

**A mini program, mobile app, extension, or device wants its own UI.** Mint an embed *session*
instead, hand the frontend only the token, and let it call the embed endpoints:

```bash
curl -s -X POST https://buda.im/api/v1/spaces/<spaceId>/agents/<agentId>/embed-sessions \
  -H "Authorization: Bearer $BUDA_API_KEY" -H "Content-Type: application/json" \
  -d '{"externalUserId":"wechat-openid-oABC123","ttlSeconds":3600,"mode":"chat"}'
# -> { "token": "...", "sessionId": "...", "api": { "statusUrl": "...", "messagesUrl": "..." }, "expiresAt": "..." }
```

The frontend then uses `POST /api/v1/embed/chat-sessions/<sessionId>/messages` and
`GET /api/v1/embed/chat-sessions/<sessionId>` with the embed token as its bearer.

Tokens expire (60s–24h, set by `ttlSeconds`). Your backend must be able to mint a fresh one
mid-conversation — pass the same `sessionId` back in to keep the same conversation. Build the
refresh path on day one; discovering it in production means every long chat dies at the TTL.

Never iframe `/api/v1/embed/...` — those are JSON APIs, not a page.

## Step 6 — Close the learning loop

The harness that gets better over time does one extra thing: when your product learns something
durable, it writes it back to Drive.

```
user finishes onboarding      -> PUT drive/files state/<userId>.md
support resolves a new issue  -> PUT drive/files playbooks/<issue>.md
device reports a new firmware -> PUT drive/files devices/<model>.md
```

The next run inherits it automatically. That is the difference between an agent that answers and
an agent that accumulates. Decide explicitly what your product is allowed to write back, and
never write raw personal data you would not want retained.

For recurring work with no user in the loop, use scheduled tasks
(`/api/v1/api-agents/<agentId>/scheduled-tasks`) instead of running your own cron that calls the API.

## Step 7 — Verify for real

Do not report a harness as working because it typechecks. Run it against the live API and
confirm, in this order:

1. `GET /users/me` returns your account (key is good).
2. Provisioning finds the Developer Space and returns a real `agentId`, and re-running reuses it.
3. A Drive file written by your code reads back unchanged.
4. A turn **completes** and the assistant message uses a fact that exists only in the Drive file —
   that proves memory is actually wired, not just uploaded.
5. A second turn in the same session recalls something said only in the first turn. Ask for
   something the agent cannot look up in Drive, or you have proven Drive twice and memory never.
6. If you built an embed surface: the frontend works holding *only* the short-lived token, and a
   refreshed token continues the same session.

Every check must **stop the run with a non-zero exit** when it fails. A check that prints "NO" and
carries on to "Done" is decoration, and so is a poll timeout that goes ahead and sends the next
message — the previous run is still going.

The `quickstart/` directory in this skill does 1–6 in one command (`pnpm demo`) and exits 1 at the
first failed check; `pnpm test` exercises every failure path offline. Start there, then replace its
in-memory session map with your database.

## Production checklist

- `sk_` key lives in a secret store, server-side only; separate keys per environment.
- Provisioning checks for an existing Space/Agent before creating one.
- Session IDs are persisted and scoped to your user, so one user cannot read another's session.
- Polling has backoff and a deadline; timeouts read as "still working".
- `waiting_for_input`, `failed`, and `cancelled` are handled distinctly in the UI, and a `failed`
  run shows `session.error` rather than a generic "something went wrong".
- The Developer Space balance is monitored and topped up before it hits zero —
  `API_CLAW_CREDITS_EXHAUSTED` stops every agent in that Space at once.
- Embed tokens are minted per end user with the shortest workable TTL, and refresh is implemented.
- Drive writes are deliberate — you can say what your product writes and why.
- You know which Space a given end user maps to, and can prove the isolation.

## Reference

- `references/api-surface.md` — every endpoint, grouped by the harness job it does.
- `references/harness-blueprint.md` — the harness's moving parts and the decisions behind them.
- `references/troubleshooting.md` — the failure modes that cost the most time.
- `quickstart/` — a runnable TypeScript harness: find the Developer Space, provision an Agent, seed
  Drive, run two turns, mint an embed token — every step checked, with offline tests.
- Live spec: `https://buda.im/api/v1/openapi.json` · Swagger UI: `https://buda.im/api/v1/doc`
