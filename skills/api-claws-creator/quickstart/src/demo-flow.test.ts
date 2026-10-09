/**
 * The demo's checks, with no network. Each test changes exactly one behavior of an in-memory
 * API and asserts which step stops the demo — and, where it matters, what was NOT sent.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  ChatMessage,
  ClawAgent,
  EmbedSession,
  SendMessageInput,
  SessionStatus,
  Space,
} from "./client.ts";
import { CONVERSATION_FACT, DemoCheckFailed, type DemoClient, runDemo } from "./demo-flow.ts";

const GOOD_FIRST_REPLY = "Hold the crown for 8 seconds until the ring glows amber, then confirm.";
const GOOD_SECOND_REPLY = CONVERSATION_FACT;

const space = (id: string, name: string, kind: Space["kind"]): Space => ({
  id,
  name,
  slug: id,
  logo: null,
  plan: "free",
  role: "owner",
  kind,
  createdAt: "2026-09-30T00:00:00.000Z",
});
const WORKSPACE = space("org_personal", "Kelly's Workspace", "workspace");
const DEVELOPER_SPACE = space("org_developer", "API Claws", "developer");

interface StubBehavior {
  /** Status each getSession poll reports for turn N (1-based). Default: "completed". */
  statusFor?: (turn: number) => SessionStatus;
  /** Assistant reply for turn N. Default: answers whatever the user actually asked. */
  replyFor?: (turn: number) => string;
  /** Session ID the server reports for turn N. Default: the same session every turn. */
  sessionIdFor?: (turn: number) => string;
  /** What reading the Drive file back returns. Default: exactly what was written. */
  readBack?: (written: string) => string;
  /** Session the embed token is issued for. Default: the one the caller asked to continue. */
  embedSessionId?: (requested: string | undefined) => string;
  /** The server's failure reason reported alongside a "failed" status. */
  failure?: { code: string; message: string };
  /** Spaces on the account. Default: a personal workspace plus the Developer Space. */
  spaces?: Space[];
  /** Store only the first user message, like a server that dedups follow-up turns away. */
  dropFollowUpUserMessages?: boolean;
}

const createStub = (behavior: StubBehavior = {}) => {
  const calls = { createSession: 0, sendMessage: 0, createEmbedSession: 0, createAgent: 0 };
  const spaces: Space[] = behavior.spaces ?? [WORKSPACE, DEVELOPER_SPACE];
  const agents: ClawAgent[] = [];
  const drive = new Map<string, string>();
  const messages: ChatMessage[] = [];
  let turn = 0;
  let lastAsked = "";

  const statusFor = behavior.statusFor ?? (() => "completed");
  // Answer the question that was asked, like the real server — not by turn count, which keeps
  // climbing when one stub serves two demo runs.
  const answer = () =>
    lastAsked.includes("serial number did I give") ? GOOD_SECOND_REPLY : GOOD_FIRST_REPLY;
  const replyFor = behavior.replyFor ?? answer;
  const sessionIdFor = behavior.sessionIdFor ?? (() => "session-1");
  const now = new Date().toISOString();

  const session = (id: string, status: SessionStatus) => ({
    id,
    agentId: "agent-1",
    spaceId: "space-1",
    title: "demo",
    status,
    promptMode: "chat" as const,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    error: status === "failed" ? (behavior.failure ?? null) : null,
  });

  const startTurn = (input: SendMessageInput) => {
    turn += 1;
    const stored = !(behavior.dropFollowUpUserMessages && messages.length > 0);
    if (stored) {
      messages.push({ id: `u${turn}`, role: "user", content: input.message, createdAt: now });
    }
    lastAsked = input.message;
    return {
      session: session(sessionIdFor(turn), "pending"),
      run: { started: true, statusUrl: "" },
    };
  };

  const client: DemoClient = {
    getMe: async () => ({ id: "user-1", name: "Demo", email: "demo@example.com", createdAt: now }),
    listSpaces: async () => ({ spaces, total: spaces.length }),
    listAgents: async (spaceId) => {
      const found = agents.filter((agent) => agent.spaceId === spaceId);
      return { agents: found, total: found.length };
    },
    createAgent: async ({ spaceId, name }) => {
      calls.createAgent += 1;
      const agent: ClawAgent = {
        id: `agent-${agents.length + 1}`,
        nodeId: "node-1",
        spaceId,
        name,
        emoji: "",
        driveId: "drive-1",
        status: "idle",
        modelId: null,
        createdAt: now,
        updatedAt: now,
      };
      agents.push(agent);
      return agent;
    },
    putDriveFile: async (_agentId, { path, content }) => {
      drive.set(path, content);
      return {
        success: true,
        file: {
          path,
          name: path,
          type: "file",
          size: content.length,
          mimeType: null,
          updatedAt: now,
        },
      };
    },
    readDriveText: async (_agentId, filePath) => {
      const written = drive.get(filePath);
      const content = written === undefined ? "" : (behavior.readBack?.(written) ?? written);
      return {
        content,
        exists: written !== undefined,
        isText: true,
        tooLarge: false,
        sizeBytes: content.length,
      };
    },
    createSession: async (_agentId, input) => {
      calls.createSession += 1;
      return startTurn(input);
    },
    sendMessage: async (_agentId, _sessionId, input) => {
      calls.sendMessage += 1;
      return startTurn(input);
    },
    getSession: async (_agentId, sessionId) => {
      const status = statusFor(turn);
      const settled = status !== "pending" && status !== "in_progress";
      const reply: ChatMessage[] = settled
        ? [{ id: `a${turn}`, role: "assistant", content: replyFor(turn), createdAt: now }]
        : [];
      return {
        session: session(sessionId, status),
        messages: [...messages, ...reply],
        run: { status, streamUrl: "", cancelUrl: "" },
      };
    },
    createEmbedSession: async (_spaceId, _agentId, input): Promise<EmbedSession> => {
      calls.createEmbedSession += 1;
      const sessionId = behavior.embedSessionId?.(input.sessionId) ?? input.sessionId ?? "fresh";
      return {
        token: "embed-token",
        embedUrl: "https://example.com/embed",
        sessionId,
        agentId: "agent-1",
        spaceId: "space-1",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        api: { statusUrl: "", messagesUrl: "" },
      };
    },
    createEmbedUrl: async () => {
      throw new Error("not used by the demo");
    },
  };

  return { client, calls };
};

const FAST_POLL = { timeoutMs: 40, initialIntervalMs: 1, maxIntervalMs: 2 };
const DEVELOPER_CENTER = "https://buda.example/developer";

const run = (client: DemoClient, spaceId?: string) =>
  runDemo({
    client,
    spaceId,
    developerCenterUrl: DEVELOPER_CENTER,
    agentName: "Demo Agent",
    poll: FAST_POLL,
  });

const failsAtStep = async (promise: Promise<unknown>, step: number, pattern: RegExp) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DemoCheckFailed, `expected DemoCheckFailed, got ${String(error)}`);
    assert.equal(error.step, step, `failed at step ${error.step}: ${error.message}`);
    assert.match(error.message, pattern);
    return true;
  });
};

describe("demo checks", () => {
  test("a correctly wired harness passes all six checks", async () => {
    const { client, calls } = createStub();
    const result = await run(client);

    assert.equal(result.first.sessionId, result.second.sessionId);
    assert.equal(result.embed.sessionId, result.first.sessionId);
    assert.equal(calls.createSession, 1, "only the first turn creates a session");
    assert.equal(calls.sendMessage, 1, "the second turn continues it");
  });

  test("runs in the Developer Space, not the personal workspace", async () => {
    const { client } = createStub();
    const result = await run(client);
    assert.equal(result.spaceId, DEVELOPER_SPACE.id);
  });

  test("re-running reuses the Agent instead of duplicating it", async () => {
    const { client, calls } = createStub();
    const firstRun = await run(client);
    const secondRun = await run(client);

    assert.equal(calls.createAgent, 1);
    assert.equal(secondRun.spaceId, firstRun.spaceId);
    assert.equal(secondRun.agentId, firstRun.agentId);
    assert.equal(secondRun.agentCreated, false);
  });

  test("step 2: no Developer Space yet stops the demo and says where to enable it", async () => {
    const { client, calls } = createStub({ spaces: [WORKSPACE] });

    await failsAtStep(run(client), 2, /no API Claws Developer Space yet.*buda\.example\/developer/);
    assert.equal(calls.createAgent, 0, "nothing is created in the personal workspace");
  });

  test("step 2: on a server that does not report kind, falls back to the Developer Space name", async () => {
    const withoutKind = ({ kind: _kind, ...rest }: Space): Space => rest;
    const { client } = createStub({
      spaces: [withoutKind(WORKSPACE), withoutKind(DEVELOPER_SPACE)],
    });
    assert.equal((await run(client)).spaceId, DEVELOPER_SPACE.id);
  });

  test("step 2: QUICKSTART_SPACE_ID pins a Space, and an unknown one is refused", async () => {
    const { client } = createStub();
    assert.equal((await run(client, WORKSPACE.id)).spaceId, WORKSPACE.id);
    await failsAtStep(run(client, "org_nope"), 2, /is not one this API key can use/);
  });

  test("step 3: a Drive file that does not read back as written stops the demo", async () => {
    const { client, calls } = createStub({ readBack: (written) => written.replace("8", "9") });

    await failsAtStep(run(client), 3, /did not read back as written/);
    assert.equal(calls.createSession, 0, "no turn is started on a broken Drive");
  });

  test("step 4 timeout: stops without posting another message into the running session", async () => {
    const { client, calls } = createStub({ statusFor: () => "in_progress" });

    await failsAtStep(run(client), 4, /still going on the server/);
    assert.equal(calls.createSession, 1);
    assert.equal(calls.sendMessage, 0, "the step-5 message must never be sent");
    assert.equal(calls.createEmbedSession, 0);
  });

  test("step 4: a run that ends as failed stops the demo", async () => {
    const { client } = createStub({ statusFor: () => "failed" });
    await failsAtStep(run(client), 4, /ended as "failed"/);
  });

  test("step 4: a failed run reports the server's reason, e.g. exhausted credits", async () => {
    const { client } = createStub({
      statusFor: () => "failed",
      failure: {
        code: "API_CLAW_CREDITS_EXHAUSTED",
        message:
          "API Claw credits are used up for this Developer Space. Top up in the Developer Center: https://buda.im/developer/api-agents",
      },
    });
    await failsAtStep(
      run(client),
      4,
      /API_CLAW_CREDITS_EXHAUSTED: .*used up.*https:\/\/buda\.im\/developer\/api-agents/,
    );
  });

  test("step 4: waiting_for_input is settled, but it is not an answer", async () => {
    const { client } = createStub({
      statusFor: () => "waiting_for_input",
      replyFor: () => "Which watch model do you have?",
    });
    await failsAtStep(run(client), 4, /asked a question instead of answering/);
  });

  test("step 4: a reply that does not use the Drive file stops the demo", async () => {
    const { client, calls } = createStub({
      replyFor: () => "Press and hold the side button for 10 seconds.",
    });

    await failsAtStep(run(client), 4, /does not use the Drive file/);
    assert.equal(calls.sendMessage, 0);
  });

  test("step 5: a turn that lands in a different session stops the demo", async () => {
    const { client } = createStub({ sessionIdFor: (turn) => `session-${turn}` });
    await failsAtStep(run(client), 5, /ran in session session-2, not session-1/);
  });

  test("step 5: a reply that forgot the conversation stops the demo", async () => {
    const { client, calls } = createStub({
      replyFor: (turn) => (turn === 1 ? GOOD_FIRST_REPLY : "I don't have that information."),
    });

    await failsAtStep(run(client), 5, /did not remember the serial number/);
    assert.equal(calls.createEmbedSession, 0);
  });

  test("step 5: a transcript missing the user's follow-up question stops the demo", async () => {
    const { client, calls } = createStub({ dropFollowUpUserMessages: true });

    await failsAtStep(run(client), 5, /missing what the user said/);
    assert.equal(calls.createEmbedSession, 0);
  });

  test("step 5: a second-turn timeout also stops the demo", async () => {
    const { client } = createStub({ statusFor: (turn) => (turn === 1 ? "completed" : "pending") });
    await failsAtStep(run(client), 5, /still going on the server/);
  });

  test("step 6: an embed token for a different session stops the demo", async () => {
    const { client } = createStub({ embedSessionId: () => "some-other-session" });
    await failsAtStep(run(client), 6, /not the user's session/);
  });
});
