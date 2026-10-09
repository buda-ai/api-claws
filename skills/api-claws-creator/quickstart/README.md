# API Claws quickstart

A runnable agent harness in a few hundred lines. It finds your Developer Space, gives an agent
durable memory, runs two real turns, polls them to a settled state, and mints a frontend-safe
token — and it stops with exit code 1 the moment any of that is not true.

## Before you run it

1. Create an API key: **Settings → API Keys** (shown once, prefixed `sk_`).
2. Enable API Claws in the **Developer Center** (`https://buda.im/developer`). That creates your
   Developer Space, where the agent runs.
3. Top up the Developer Space. It has no free credits, and every run fails with
   `API_CLAW_CREDITS_EXHAUSTED` until it has some.

## Run it

```bash
cp .env.example .env      # put your sk_ key in it
pnpm install
pnpm demo
```

`pnpm demo` performs six checks in order. The first one that fails stops the demo with exit
code 1 and says why:

1. the key resolves to your account
2. the Developer Space is found, and the Agent is found or created — re-running reuses it
3. a Drive file reads back exactly as written
4. a turn **completes**, and the answer uses a fact that exists only in that Drive file —
   **this is where the harness becomes real**
5. a second turn runs in the **same session** and recalls a serial number said only in the first
   turn, so it proves memory, not a second Drive lookup
6. an embed token is minted for that same session

If step 4 is still running when polling gives up, the demo stops there instead of sending the
step-5 message: the first run is still going, and a second message would start a second run.
Raise `QUICKSTART_POLL_TIMEOUT_MS` if your turns legitimately take longer.

## Also here

```bash
pnpm chat       # interactive terminal chat; /new starts a fresh session, /quit exits
pnpm embed      # both frontend-safe paths — hosted iframe URL, and a token for your own UI
pnpm test       # every demo failure path, offline, against an in-memory API
pnpm typecheck
```

## What is what

| File | What it is |
| --- | --- |
| `src/client.ts` | A dependency-free typed client for the endpoints a harness needs |
| `src/harness.ts` | **The part you own**: identity mapping, turn loop, knowledge writes, credential boundary |
| `src/demo-flow.ts` | The six checks above, as a function that fails fast |
| `src/demo-flow.test.ts` | Offline tests: timeout, failed run, ungrounded answer, lost context, wrong session |
| `src/demo.ts` | Runs the checks against the live API and sets the exit code |
| `src/chat.ts` | The turn loop with a human in it |
| `src/embed.ts` | Minting tokens for surfaces that cannot hold the `sk_` key |
| `src/config.ts` | Reads `.env`, so the key never appears in argv or shell history |

## Taking it to production

One thing is deliberately fake: `InMemorySessionStore`. Replace it with your database so
sessions survive a restart:

```ts
class DbSessionStore implements SessionStore {
  async get(externalUserId: string) {
    const row = await db.users.findOne({ id: externalUserId });
    return row?.budaSessionId ?? undefined;
  }
  async set(externalUserId: string, sessionId: string) {
    await db.users.update({ id: externalUserId }, { budaSessionId: sessionId });
  }
  async clear(externalUserId: string) {
    await db.users.update({ id: externalUserId }, { budaSessionId: null });
  }
}
```

Always look sessions up by the **authenticated** user. Accepting a session ID from the client is
how one user ends up reading another user's conversation.

Everything else in `harness.ts` is production-shaped already: the poll loop backs off and treats
its deadline as a display decision rather than a run failure, all four settled statuses are
handled, and the `sk_` key never leaves the server.

The remaining pieces are yours: your auth, your UI, your error states, and a token refresh path
before you ship anything embedded.

## If something goes wrong

`../references/troubleshooting.md` covers the failure modes worth knowing in advance — the poll
loop that never ends, the agent with amnesia, duplicate Spaces after a deploy, and chats that die
at exactly the TTL.
