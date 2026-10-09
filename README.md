# API Claws

**Give your product a cloud AI agent, without building the agent infrastructure.**

An agent skill and a runnable TypeScript quickstart for building an *agent harness* on
[Buda API Claws](https://buda.im/en/docs/developers/api-claws) — the hosted Agent API where the
runtime, durable memory, sessions, and tenant isolation are already operated for you.

## What is an agent harness?

A harness is everything that surrounds a model so it behaves like a coworker instead of a text
completion: a runtime that can actually do work, memory that survives the conversation, one
isolated context per end user, and a boundary between customers.

Building all of that is weeks of work. API Claws hosts it — so the harness you write is the thin
part, the part that knows your users and your product:

| Harness part | Who owns it |
| --- | --- |
| Model access, provider switching, keys | API Claws |
| Agent runtime, tool sandboxing | API Claws |
| Durable memory / knowledge base | API Claws (Drive) |
| Session and context management | API Claws |
| Tenant isolation | API Claws (Spaces) |
| Wake/sleep of idle agents | API Claws |
| **Identity mapping** — your user → a session | **You** |
| **Turn loop** — send, poll, render | **You** |
| **Knowledge writes** — what your product learns | **You** |
| **Surface** — UI, voice, chat, webhook | **You** |

Four rows. That is the whole job, and this repo walks through each one.

## Who this is for

- **Hardware teams** — watches, earbuds, speakers, IoT. The device handles input and output; the
  agent runs in the cloud, and upgrades ship server-side instead of as firmware.
- **App and mini-program developers** — embed AI chat without shipping a key to the client.
- **SaaS teams** — give every customer tenant a private copilot with its own knowledge base.
- **Internal tools** — an agent per department, isolated from the rest.

## Start here

Install the skill, so your coding agent builds the integration with you:

```bash
npx skills add buda-ai/api-claws
```

That works across Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, Zed and more —
the installer detects what you have. Add `-g` to install for every project instead of this one,
and `npx skills update` to pull later changes.

Then ask for what you are actually building:

> Add an AI support agent to our smartwatch companion app. Each customer should get their own
> isolated agent that answers from our device manuals.

Prefer to read before you install? Everything is in
[`skills/api-claws-creator/SKILL.md`](skills/api-claws-creator/SKILL.md).

## Run the quickstart

The skill ships with a runnable harness. After installing, it is at
`.agents/skills/api-claws-creator/quickstart` — or clone this repo and use
`skills/api-claws-creator/quickstart`.

**Before you run it:**

1. Create an API key: **Settings → API Keys** on [buda.im](https://buda.im) (shown once, prefixed
   `sk_`).
2. Enable API Claws in the **[Developer Center](https://buda.im/developer)**. That creates your
   Developer Space — where the agent runs, separate from your personal workspace.
3. Top up the Developer Space. It has no free credits, and every run fails with
   `API_CLAW_CREDITS_EXHAUSTED` (with a link back to the top-up page) until it has some.

```bash
cd .agents/skills/api-claws-creator/quickstart
cp .env.example .env      # put your sk_ key in it
pnpm install
pnpm demo
```

`pnpm demo` performs six checks in order, and the first one that fails stops it with exit code 1
and says why: the key resolves to your account, the Developer Space and Agent are found, a Drive
file reads back exactly as written, a turn completes using a fact that exists only in that Drive
file — **this is where the harness becomes real** — a second turn in the same session recalls
something said only in conversation (proving memory, not a second Drive lookup), and an embed
token is minted for that session.

Then `pnpm chat` for the turn loop with a human in it, `pnpm embed` for the two ways to reach a
frontend that cannot hold your API key, and `pnpm test` for the offline suite covering every
failure path above with no network calls.

## What is inside

```
skills/api-claws-creator/
├── SKILL.md                          seven steps, from key check to production checklist
├── references/
│   ├── api-surface.md                every endpoint, grouped by the harness job it does
│   ├── harness-blueprint.md          the four parts you own, and the decisions behind them
│   └── troubleshooting.md            the failure modes that cost the most time
└── quickstart/                       a runnable, dependency-free TypeScript harness
    └── src/
        ├── client.ts                 dependency-free typed API client
        ├── harness.ts                identity mapping, turn loop, memory, credential boundary
        ├── demo-flow.ts              the six checks, as a function that fails fast
        ├── demo-flow.test.ts         offline tests for every failure path, no network
        ├── demo.ts                   runs the checks against the live API
        ├── chat.ts                   interactive terminal chat
        └── embed.ts                  frontend-safe access, both paths
```

## Three things that will save you a day

Learned the hard way, covered in depth in
[`troubleshooting.md`](skills/api-claws-creator/references/troubleshooting.md):

1. **`waiting_for_input` is a settled state, not a failure.** A poll loop that only waits for
   `completed` spins until it times out while the agent sits there waiting for an answer.
2. **A poll timeout is a display decision, not a run failure.** The run keeps going server-side.
   Say "still working" — resending starts a second run and the user sees the answer twice.
3. **API Claws runs in its own Developer Space, not your personal workspace.** A free account may
   own only one personal workspace, so `POST /spaces` on it fails with
   `FREE_OWNER_SPACE_LIMIT_REACHED` — your agents don't need it; they belong in the Developer
   Space the Developer Center creates when you enable API Claws.

## Links

- [API Claws documentation](https://buda.im/en/docs/developers/api-claws)
- [Authentication](https://buda.im/en/docs/developers/authentication) — create your `sk_` key
- [OpenAPI spec](https://buda.im/api/v1/openapi.json) · [Swagger UI](https://buda.im/api/v1/doc)
- [buda-cli](https://github.com/buda-ai/buda-cli) — official Rust CLI over the same API

## License

MIT — see [LICENSE](LICENSE).
