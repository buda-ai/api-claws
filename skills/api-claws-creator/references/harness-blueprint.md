# Harness blueprint

The decisions behind the code. Read this before you design the integration; the API details in
`api-surface.md` only matter once these are settled.

## The four parts you actually own

Everything else — runtime, model access, sandboxing, wake/sleep, memory storage — is hosted.
What is left is small, which is the point, but each part has one way to get it wrong.

### 1. Identity mapping

You need a table that answers "which agent, which session, for this person right now".

```
your_users
  id
  buda_space_id     -- which tenant they belong to
  buda_agent_id     -- which agent serves them
  buda_session_id   -- their current conversation (nullable)
  session_started_at
```

Getting it wrong looks like: every message starts a new session and the agent has amnesia; or
two users share a session and see each other's messages. The second one is a data-leak bug, so
make the session lookup always go through the authenticated user, never through a client-supplied
session ID.

Decide when a session ends. Common policies: never (one long-running thread per user), on idle
timeout (a new session after N hours of silence), or per task (a new session per support ticket).
Long-running threads accumulate context; per-task sessions stay focused. Support products usually
want per-task; assistants usually want long-running.

### 2. The turn loop

```
send message ──▶ 202 { session, run }
                      │
                      ▼
                 poll session  ──▶ pending / in_progress ──┐
                      │                                    │ backoff, retry
                      │◀───────────────────────────────────┘
                      ▼
        completed │ waiting_for_input │ failed │ cancelled
```

Four settled states, four different things to show a user:

| Status | What it means | What the user should see |
| --- | --- | --- |
| `completed` | The agent finished | The reply |
| `waiting_for_input` | The agent asked *you* something | The question, and an input box |
| `failed` | The run errored | A retry affordance, not a stack trace |
| `cancelled` | Someone cancelled it | Neutral acknowledgement |

Treating `waiting_for_input` as "not done yet" is the most common harness bug: the poll loop
spins until it times out while the agent sits there waiting for an answer that never comes.

Your poll deadline is a *display* decision, not a *run* decision. When you stop polling, the run
keeps going server-side. So on timeout, say "still working" and let the user come back — do not
say "failed", and do not resend the message, which starts a second run.

### 3. Knowledge writes

Three tiers, and mixing them up is what makes agents both expensive and forgetful:

| Tier | Lives in | Example | Cost of getting it wrong |
| --- | --- | --- | --- |
| Standing role | Agent `instructions` | "You are a support agent for Acme." | Personality drift |
| Durable facts | Drive files | Manuals, policies, per-customer state | You re-send the manual every turn |
| This turn | The message | "My device won't reset." | Nothing; this is correct |

The test: *if the user closed the app and came back tomorrow, should the agent still know this?*
Yes → Drive. No → message.

Give Drive a path convention on day one:

```
manuals/       product documentation, stable
policies/      refund, escalation, tone rules
playbooks/     how to handle recurring situations
state/<id>.md  per-user or per-device durable state
```

Decide explicitly what your product writes back and when. "Write everything the user says to
Drive" is not a memory strategy — it is a retention liability.

### 4. The credential boundary

There is exactly one rule: the `sk_` key stays on your server.

```
device / browser / mini program        your backend              Buda
        │                                   │                      │
        │──── your own auth ───────────────▶│                      │
        │                                   │─── sk_ key ─────────▶│  mint embed session
        │◀─── short-lived token ────────────│◀── token ────────────│
        │                                                          │
        │────────── embed token only ─────────────────────────────▶│  /embed/... calls
```

If a surface cannot keep a secret — anything shipped to users — it gets a token, not the key.
Tokens are scoped to one end user and one session and expire in 60s–24h.

Build token refresh before you ship. A conversation longer than the TTL is normal, and the
symptom of missing refresh is that every long chat dies silently at the same elapsed time.

## Choosing your surface

| Your surface | Use | Why |
| --- | --- | --- |
| SaaS backend, internal tool, device backend | `sk_` key, server-to-server | Nothing untrusted holds the key |
| Website, admin panel, customer portal | `POST /embed-urls`, iframe the result | Working chat UI for free |
| Mini program, mobile app, extension | `POST /embed-sessions` + `/embed/...` | Your UI, no iframe constraints, no cookie issues |
| Slack, Discord, WhatsApp, WeChat | Channels API | The platform integration is hosted too |
| No user present (reports, digests, sweeps) | Scheduled tasks | The schedule lives with the agent, not in your cron |

## Scaling shape

- **Provisioning is your idempotency problem.** `POST /spaces` always creates. List first, or key
  provisioning to your own customer record and store the result before the next retry can fire.
- **Spaces are the billing unit.** You buy them; how you charge end users is yours. This is why
  "one Space per end user" is usually wrong and "one Space per paying customer" is usually right.
- **Idle agents cost nothing.** You do not need to tear down agents between conversations. Resist
  the urge to build a pool.
- **Credits are checked per Space**, not as a per-request rate limit. Watch balance, not QPS.

## What to build first

1. Key check (`/users/me`) — proves the boundary.
2. Provision one Space + one Agent by hand, hardcode the IDs.
3. One turn, polled to a settled state, printed to stdout.
4. Drive file, then a turn whose answer depends on it. **This is the moment the harness is real.**
5. Only then: your database, your surface, your auth, your error states.

Building 5 before 4 is how people spend a week on a harness that turns out to have been one
`401` all along.
