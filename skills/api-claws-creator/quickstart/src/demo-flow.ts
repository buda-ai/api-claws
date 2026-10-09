/**
 * The six demo checks as one function, so they can run against the live API (`pnpm demo`) or
 * against a stub with no network (`pnpm test`).
 *
 * Every check throws DemoCheckFailed. Nothing is printed as "NO" and carried on: a harness that
 * is not wired correctly must stop the demo with a non-zero exit, not reach "Done".
 */

import type { ApiClawsClient, ChatMessage, EmbedSession } from "./client.ts";
import {
  AgentHarness,
  type HarnessClient,
  type PollOptions,
  type ProvisioningClient,
  ProvisioningError,
  provisionAgent,
  type TurnResult,
} from "./harness.ts";

export class DemoCheckFailed extends Error {
  constructor(
    readonly step: number,
    message: string,
  ) {
    super(message);
    this.name = "DemoCheckFailed";
  }
}

export const INSTRUCTIONS = [
  "You are a smartwatch support assistant.",
  "Use the files in your Drive as the source of truth; prefer them over general knowledge.",
  "Keep replies short enough to read on a small screen.",
].join(" ");

export const MANUAL_PATH = "manuals/reset-device.md";
export const MANUAL_CONTENT = `# Resetting the Acme Watch

Hold the crown for 8 seconds until the ring glows amber, then confirm on screen.
The device restarts twice; this is expected.

If the screen stays dark, put it on the charger for 15 minutes and retry.
`;

/**
 * The Drive-only fact the step-4 answer must contain. "Hold for 8 seconds" is specific to this
 * manual; a generic smartwatch answer ("hold the side button for 10 seconds") does not pass.
 */
export const DRIVE_FACT = /\b(8|eight)[\s-]*(seconds?|secs?)\b/i;

/**
 * A fact that exists ONLY in the conversation, never in Drive. Asking for it in step 5 is what
 * proves the session kept context — the agent cannot look it up anywhere else.
 */
export const CONVERSATION_FACT = "ACW-4821";

export const DEMO_USER = "demo-user-1";
export const FIRST_QUESTION = `My watch's serial number is ${CONVERSATION_FACT}. How do I reset it?`;
export const SECOND_QUESTION =
  "What serial number did I give you earlier in this conversation? Reply with just the serial.";

// ── Checks. Pure, so each failure mode is unit-tested on its own. ──────────────────────────────

export const checkDriveReadBack = (readBack: string | undefined, written: string): void => {
  if (readBack?.trim() !== written.trim()) {
    throw new DemoCheckFailed(
      3,
      `The Drive file did not read back as written (${written.length} chars written, ` +
        `${readBack === undefined ? "nothing" : `${readBack.length} chars`} read back).`,
    );
  }
};

export const checkTurnCompleted: (
  step: number,
  turn: TurnResult,
) => asserts turn is TurnResult & { reply: string } = (step, turn) => {
  if (turn.timedOut) {
    throw new DemoCheckFailed(
      step,
      `Stopped polling while session ${turn.sessionId} was still "${turn.status}". The run is ` +
        "still going on the server, so the demo stops here rather than sending another message " +
        "into the same session — that would start a second run. Re-run `pnpm demo` once it has " +
        "finished, or raise QUICKSTART_POLL_TIMEOUT_MS.",
    );
  }
  if (turn.status === "waiting_for_input") {
    throw new DemoCheckFailed(
      step,
      `The agent asked a question instead of answering: "${turn.reply ?? ""}".`,
    );
  }
  if (turn.status !== "completed") {
    const reason = turn.error ? ` ${turn.error.code}: ${turn.error.message}` : "";
    throw new DemoCheckFailed(step, `The run ended as "${turn.status}", not "completed".${reason}`);
  }
  if (!turn.reply) {
    throw new DemoCheckFailed(step, "The run completed but produced no assistant reply.");
  }
};

export const checkGroundedInDrive = (reply: string): void => {
  if (!DRIVE_FACT.test(reply)) {
    throw new DemoCheckFailed(
      4,
      "The reply does not use the Drive file — it should say to hold the crown for 8 seconds. " +
        "Check that the agent's instructions tell it to use Drive. " +
        `Reply was: "${reply}"`,
    );
  }
};

export const checkSameSession = (first: TurnResult, second: TurnResult): void => {
  if (second.sessionId !== first.sessionId) {
    throw new DemoCheckFailed(
      5,
      `The second turn ran in session ${second.sessionId}, not ${first.sessionId}. ` +
        "Later turns must go to the same session or the agent starts from nothing.",
    );
  }
};

export const checkRetainsContext = (reply: string): void => {
  if (!reply.includes(CONVERSATION_FACT)) {
    throw new DemoCheckFailed(
      5,
      `The agent did not remember the serial number ${CONVERSATION_FACT} from the previous ` +
        `turn, so the session did not keep context. Reply was: "${reply}"`,
    );
  }
};

export const checkTranscript = (messages: ChatMessage[]): void => {
  const asked = messages.filter((message) => message.role === "user").map((m) => m.content);
  const missing = [FIRST_QUESTION, SECOND_QUESTION].filter(
    (question) => !asked.some((content) => content.includes(question)),
  );
  if (missing.length > 0) {
    throw new DemoCheckFailed(
      5,
      `The session's messages are missing what the user said: ${missing.map((q) => `"${q}"`).join(", ")}. ` +
        "A chat UI rendered from this session would show the agent answering questions nobody asked.",
    );
  }
};

export const checkEmbedSession = (
  embed: EmbedSession,
  sessionId: string,
  now: number = Date.now(),
): void => {
  if (!embed.token) {
    throw new DemoCheckFailed(6, "The embed session came back without a token.");
  }
  if (embed.sessionId !== sessionId) {
    throw new DemoCheckFailed(
      6,
      `The embed token is for session ${embed.sessionId}, not the user's session ${sessionId}. ` +
        "A token refresh would restart the conversation instead of continuing it.",
    );
  }
  if (!(Date.parse(embed.expiresAt) > now)) {
    throw new DemoCheckFailed(6, `The embed token is already expired (${embed.expiresAt}).`);
  }
};

// ── The demo ────────────────────────────────────────────────────────────────────────────────

export type DemoClient = HarnessClient & ProvisioningClient & Pick<ApiClawsClient, "getMe">;

export interface DemoOptions {
  client: DemoClient;
  /** Pin a Space. Unset = the account's API Claws Developer Space. */
  spaceId?: string;
  developerCenterUrl: string;
  agentName: string;
  poll?: PollOptions;
  log?: (line: string) => void;
}

export interface DemoResult {
  spaceId: string;
  agentId: string;
  agentCreated: boolean;
  first: TurnResult & { reply: string };
  second: TurnResult & { reply: string };
  embed: EmbedSession;
}

const indent = (text: string) => `    ${text.replace(/\n/g, "\n    ")}`;

export const runDemo = async (options: DemoOptions): Promise<DemoResult> => {
  const { client } = options;
  const log = options.log ?? (() => {});
  const step = (n: number, title: string) => log(`\n[${n}/6] ${title}`);

  step(1, "Checking the API key");
  const me = await client.getMe();
  log(`    key belongs to ${me.email}`);

  step(2, "Finding the Developer Space, and finding or creating the Agent");
  const { space, agent, created } = await provisionAgent(client, {
    spaceId: options.spaceId,
    developerCenterUrl: options.developerCenterUrl,
    agentName: options.agentName,
    instructions: INSTRUCTIONS,
  }).catch((error: unknown) => {
    if (error instanceof ProvisioningError) throw new DemoCheckFailed(2, error.message);
    throw error;
  });
  log(`    space ${space.id} (${space.name}${space.kind ? `, ${space.kind}` : ""})`);
  log(`    agent ${agent.id} (${created ? "created now" : "already existed — reused"})`);

  const harness = new AgentHarness({
    client,
    agentId: agent.id,
    spaceId: space.id,
    poll: options.poll,
  });

  step(3, "Writing durable knowledge to Drive and reading it back");
  await harness.remember(MANUAL_PATH, MANUAL_CONTENT);
  checkDriveReadBack(await harness.recall(MANUAL_PATH), MANUAL_CONTENT);
  log(`    ${MANUAL_PATH} written and read back unchanged`);

  step(4, "A turn whose answer needs the Drive file");
  log(`    you: ${FIRST_QUESTION}`);
  const first = await harness.ask(DEMO_USER, FIRST_QUESTION);
  checkTurnCompleted(4, first);
  log(`    agent (${first.status}):\n${indent(first.reply)}`);
  checkGroundedInDrive(first.reply);
  log("    ✓ the answer uses the Drive file");

  // Only reached when step 4 settled. A timed-out run is still going server-side; posting here
  // would start a second run in the same session, which is exactly what the docs warn against.
  step(5, "A second turn in the same session — does it keep context?");
  log(`    you: ${SECOND_QUESTION}`);
  const second = await harness.ask(DEMO_USER, SECOND_QUESTION);
  checkTurnCompleted(5, second);
  checkSameSession(first, second);
  log(`    agent (${second.status}):\n${indent(second.reply)}`);
  checkRetainsContext(second.reply);
  checkTranscript(second.messages);
  log("    ✓ same session, it remembered something only said in the conversation,");
  log("      and the session's messages show both of the user's questions");

  step(6, "Minting an embed token for a frontend");
  const embed = await harness.mintEmbedToken(DEMO_USER, 600);
  checkEmbedSession(embed, first.sessionId);
  log(`    ✓ token issued for the same session, expires ${embed.expiresAt}`);
  log("    the frontend gets this token and NEVER the sk_ key");

  return {
    spaceId: space.id,
    agentId: agent.id,
    agentCreated: created,
    first,
    second,
    embed,
  };
};
