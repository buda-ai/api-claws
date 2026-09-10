# API Claws quickstart

A runnable agent harness in about 250 lines. It provisions a tenant, gives the agent durable
memory, runs a real turn, polls it to a settled state, and mints a frontend-safe token.

## Run it

```bash
cp .env.example .env      # put your sk_ key in it
pnpm install
pnpm demo
```

`pnpm demo` performs six checks in order, and each one fails loudly rather than silently:

1. the key resolves to your account
2. provisioning is idempotent — re-running reuses the Space and Agent instead of duplicating them
3. a Drive write reads back correctly
4. a turn settles, and the answer draws on the Drive file — **this is where the harness becomes real**
5. a second turn in the same session keeps context
6. an embed token can be minted for a frontend

Expect step 4 to take a few seconds: the run is asynchronous, so the harness polls until it settles.

## Also here

```bash
pnpm chat     # interactive terminal chat; /new starts a fresh session, /quit exits
pnpm embed    # both frontend-safe paths — hosted iframe URL, and a token for your own UI
pnpm typecheck
```

## What is what

| File | What it is |
| --- | --- |
| `src/client.ts` | A dependency-free typed client for the endpoints a harness needs |
| `src/harness.ts` | **The part you own**: identity mapping, turn loop, knowledge writes, credential boundary |
| `src/demo.ts` | The six checks above |
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
