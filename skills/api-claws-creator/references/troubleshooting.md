# Troubleshooting

The failure modes that cost the most time, in the order you are likely to hit them.

## Every run fails immediately, with no messages

**Symptom:** the session goes straight to `failed`; `messages` is empty, not even your own message.

**Cause:** read `session.error`. Almost always it is `API_CLAW_CREDITS_EXHAUSTED`: the Developer
Space credits are used up, so the run is refused before it starts. The Developer Space gets no free
credits.

**Fix:** the error message carries the link — the Developer Center page with the top-up action
(`https://buda.im/developer/api-agents`). Do not retry in a loop: nothing changes until the balance
does, and every agent in that Space is stopped the same way.

## The poll loop never ends

**Symptom:** your code waits until the deadline and reports a timeout, but the dashboard shows the
agent answered.

**Cause:** you are waiting for `completed` only. The run settled at `waiting_for_input` — the
agent asked a clarifying question — and your loop does not treat that as an ending.

**Fix:** stop on any of `completed`, `waiting_for_input`, `failed`, `cancelled`. Render
`waiting_for_input` as a question with an input box, and answer it with
`POST /sessions/{sessionId}/messages` on the same session.

## The agent has amnesia

**Symptom:** every message gets a fresh, context-free reply.

**Cause:** each turn calls `POST /api-agents/{agentId}/sessions`, which creates a *new* session.

**Fix:** create the session once, persist its ID against your user, and send later turns to
`POST /api-agents/{agentId}/sessions/{sessionId}/messages`. If the agent forgets things across
sessions *by design* but should not, those facts belong in Drive, not in conversation history.

## The agent ignores the manual you uploaded

**Symptom:** the Drive file is there in `GET /drive/files`, but answers do not reflect it.

**Check, in order:**
1. Is it in the right agent's Drive? Two agents in the same Space have separate Drives.
2. Do the `instructions` tell it to use Drive as the source of truth? Drive is **not** pasted into
   the prompt — the agent reads files with its own tools when it decides to. A file it is never
   told to consult is just storage.
3. Is the content actually text? Write markdown with `mimeType: "text/markdown"`; a binary blob
   is not readable knowledge.
4. Is the question answerable from that file at all? Read the file back with
   `POST /drive/text` and check what you actually stored — escaped `\n` written as literal
   backslash-n is a common one.

## `403 FREE_OWNER_SPACE_LIMIT_REACHED` from `POST /spaces`

This only happens when you create *extra* Spaces — API Claws itself runs in the Developer Space
and never needs this call. `POST /spaces` creates an ordinary workspace owned by your account, and
an account may own one free workspace (the one sign-up already made). Keep your agents in the
Developer Space; per-customer workspaces need a plan that includes them.

## Duplicate Spaces after a deploy

**Symptom:** your customer count in Buda is higher than your customer count.

**Cause:** `POST /spaces` always creates (on plans that allow more than one Space). A retry, a
restarted worker, or a double-fired webhook provisions again. The same is true of
`POST /api-agents`.

**Fix:** make provisioning idempotent on your side — check your own database first, or
`GET /spaces` and match by name/slug before creating. Store the returned `spaceId` in the same
transaction that marks the customer as provisioned.

## `403` where you expected `404`

The ID exists but belongs to a Space your key does not own — usually a staging agent ID left in a
production config, or an agent ID from a different account's key. Verify with `GET /users/me` that
the key resolves to the account you think, then `GET /spaces` to see what it actually owns.

## `401` on every call

- The key was truncated on copy (they are long; check the tail, not just the `sk_` head).
- The key expired — expiry is set at creation and cannot be extended; create a new one.
- The header is malformed: it must be `Authorization: Bearer sk_...`, not `Bearer: sk_...` and
  not the raw key.
- The key was deleted. Deletion is immediate and in-flight requests start failing at once.

## Chats die after exactly the same interval

**Symptom:** every embed conversation breaks at, say, one hour.

**Cause:** the embed token hit its `ttlSeconds` and there is no refresh path.

**Fix:** mint a new token from your backend when the frontend sees an auth failure, passing the
existing `sessionId` in the mint body so the conversation continues rather than restarting.
Refresh proactively before expiry if you know the TTL.

## The iframe is blank or shows JSON

You iframed the wrong URL. Iframe exactly the `embedUrl` returned by `POST /embed-urls`, including
its `#token=` fragment. The `/api/v1/embed/...` routes are JSON APIs for your own UI — they render
as raw JSON or fail outright in a frame.

Also check that you did not strip the hash fragment somewhere in your templating — the token lives
there, and a URL without it loads an unauthorized page.

## Duplicate replies after a timeout

**Symptom:** the user sees the answer twice.

**Cause:** your poll deadline fired, and you resent the message. The first run was still going;
now there are two.

**Fix:** a poll timeout is a display decision, not a run failure. Stop polling, keep the session
ID, tell the user it is still working, and read the result on the next poll or page load. Never
auto-resend on timeout.

## Attachments upload but never appear

Both the Drive upload and the chat attachment flow are two steps. `POST /drive/upload-url` gives a
presigned target; you must PUT the bytes there and then call `POST /drive/confirm-upload`. Skipping
the confirm leaves the upload in `initiated`. Check
`GET /drive/uploads/{uploadSessionId}` — it reports `initiated | uploaded | processing | completed | failed | aborted`
and whether the failure is `retryable`.

## Scheduled task rejected

Check `GET /scheduled-tasks/limits` first. Plans differ in `maxCount`, `minIntervalMinutes`, and
`allowCron` — a cron expression on a plan where `allowCron` is false fails no matter how valid the
expression is. Validate the expression itself with `POST /scheduled-tasks/validate-cron`.

## Everything works locally, nothing works in production

Almost always separate keys per environment, and the production one was never created, never
deployed, or points at a Space provisioned under the staging account. Run the same three checks
from the production host: `/health` (reachability), `/users/me` (identity), `/spaces` (ownership).
