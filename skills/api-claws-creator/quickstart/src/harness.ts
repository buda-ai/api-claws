/**
 * The harness: the part you own.
 *
 * Four jobs, and nothing else — identity mapping, the turn loop, knowledge writes, and keeping
 * the sk_ key server-side. Everything underneath (runtime, model, sandbox, storage) is hosted.
 *
 * The only thing to replace for production is the SessionStore: swap InMemorySessionStore for
 * your database so sessions survive a restart.
 */

import {
  type ApiClawsClient,
  type ChatMessage,
  type ClawAgent,
  type PromptMode,
  SETTLED_STATUSES,
  type SessionDetail,
  type SessionStatus,
  type Space,
} from "./client.ts";

/**
 * The slice of the client the harness uses. Structural on purpose: pass the real ApiClawsClient,
 * your own wrapper, or a test stub.
 */
export type HarnessClient = Pick<
  ApiClawsClient,
  | "createSession"
  | "sendMessage"
  | "getSession"
  | "putDriveFile"
  | "readDriveText"
  | "createEmbedSession"
  | "createEmbedUrl"
>;

/** The slice of the client provisioning uses. */
export type ProvisioningClient = Pick<ApiClawsClient, "listSpaces" | "listAgents" | "createAgent">;

// ── 1. Identity mapping ──────────────────────────────────────────────────────

/**
 * Maps one of YOUR users to their current conversation.
 *
 * Always look sessions up by the authenticated user. Never accept a session ID from the client:
 * that is how one user ends up reading another user's conversation.
 */
export interface SessionStore {
  get(externalUserId: string): Promise<string | undefined>;
  set(externalUserId: string, sessionId: string): Promise<void>;
  clear(externalUserId: string): Promise<void>;
}

/** Fine for the quickstart. In production this is a table. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, string>();

  async get(externalUserId: string) {
    return this.sessions.get(externalUserId);
  }

  async set(externalUserId: string, sessionId: string) {
    this.sessions.set(externalUserId, sessionId);
  }

  async clear(externalUserId: string) {
    this.sessions.delete(externalUserId);
  }
}

// ── 2. The turn loop ─────────────────────────────────────────────────────────

export interface TurnResult {
  sessionId: string;
  status: SessionStatus;
  /** The agent's latest reply, or undefined if it never produced one. */
  reply?: string;
  messages: ChatMessage[];
  /** True when polling gave up. The run is STILL GOING server-side — do not resend. */
  timedOut: boolean;
  /** The server's reason when status is "failed" — e.g. API_CLAW_CREDITS_EXHAUSTED. */
  error: { code: string; message: string } | null;
}

export interface PollOptions {
  /** How long to wait before showing "still working". Default 120s. */
  timeoutMs?: number;
  /** First poll delay. Default 1s, widening to maxIntervalMs. */
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  onStatus?: (status: SessionStatus) => void;
}

export interface HarnessOptions {
  client: HarnessClient;
  agentId: string;
  spaceId: string;
  sessionStore?: SessionStore;
  defaultMode?: PromptMode;
  poll?: PollOptions;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const latestAssistantReply = (messages: ChatMessage[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content.trim()) return message.content;
  }
  return undefined;
};

export class AgentHarness {
  private readonly client: HarnessClient;
  private readonly sessions: SessionStore;
  private readonly defaultMode: PromptMode;
  private readonly pollOptions: Required<Omit<PollOptions, "onStatus">> &
    Pick<PollOptions, "onStatus">;

  readonly agentId: string;
  readonly spaceId: string;

  constructor(options: HarnessOptions) {
    this.client = options.client;
    this.agentId = options.agentId;
    this.spaceId = options.spaceId;
    this.sessions = options.sessionStore ?? new InMemorySessionStore();
    this.defaultMode = options.defaultMode ?? "chat";
    this.pollOptions = {
      timeoutMs: options.poll?.timeoutMs ?? 120_000,
      initialIntervalMs: options.poll?.initialIntervalMs ?? 1_000,
      maxIntervalMs: options.poll?.maxIntervalMs ?? 3_000,
      onStatus: options.poll?.onStatus,
    };
  }

  /**
   * One turn for one of your users.
   *
   * Continues their existing session when there is one, so the agent keeps context. Creating a
   * new session every turn is what makes an agent look like it has amnesia.
   */
  async ask(externalUserId: string, message: string, mode?: PromptMode): Promise<TurnResult> {
    const existingSessionId = await this.sessions.get(externalUserId);
    const input = { message, mode: mode ?? this.defaultMode };

    const started = existingSessionId
      ? await this.client.sendMessage(this.agentId, existingSessionId, input)
      : await this.client.createSession(this.agentId, input);

    const sessionId = started.session.id;
    await this.sessions.set(externalUserId, sessionId);

    return this.waitForReply(sessionId);
  }

  /**
   * Poll until the run settles.
   *
   * Settled means any of completed / waiting_for_input / failed / cancelled. Waiting only for
   * `completed` is the single most common harness bug: `waiting_for_input` means the agent asked
   * YOU something, and a loop that ignores it spins until the deadline.
   */
  async waitForReply(sessionId: string): Promise<TurnResult> {
    const deadline = Date.now() + this.pollOptions.timeoutMs;
    let interval = this.pollOptions.initialIntervalMs;
    let detail: SessionDetail | undefined;

    while (Date.now() < deadline) {
      await sleep(interval);
      interval = Math.min(Math.round(interval * 1.5), this.pollOptions.maxIntervalMs);

      detail = await this.client.getSession(this.agentId, sessionId);
      this.pollOptions.onStatus?.(detail.session.status);

      if (SETTLED_STATUSES.includes(detail.session.status)) {
        return {
          sessionId,
          status: detail.session.status,
          reply: latestAssistantReply(detail.messages),
          messages: detail.messages,
          timedOut: false,
          error: detail.session.error ?? null,
        };
      }
    }

    // The deadline is a DISPLAY decision, not a run failure. The agent is still working; tell the
    // user that and read the result later. Resending here would start a second run.
    return {
      sessionId,
      status: detail?.session.status ?? "in_progress",
      messages: detail?.messages ?? [],
      timedOut: true,
      error: null,
    };
  }

  /** End the current conversation. The next ask() starts a fresh session. */
  async endConversation(externalUserId: string): Promise<void> {
    await this.sessions.clear(externalUserId);
  }

  // ── 3. Knowledge writes ────────────────────────────────────────────────────

  /**
   * Write something durable into the agent's Drive.
   *
   * The test for whether it belongs here: if the user closed the app and came back tomorrow,
   * should the agent still know this? Yes -> Drive. No -> it belongs in the message.
   */
  async remember(path: string, content: string, mimeType = "text/markdown"): Promise<void> {
    await this.client.putDriveFile(this.agentId, { path, content, mimeType });
  }

  /** Read a Drive file back — useful for proving what you actually stored. */
  async recall(path: string): Promise<string | undefined> {
    const result = await this.client.readDriveText(this.agentId, path);
    return result.exists && result.isText ? result.content : undefined;
  }

  // ── 4. Credential boundary ─────────────────────────────────────────────────

  /**
   * Mint a short-lived token for a frontend that cannot hold the sk_ key — a browser, mini
   * program, mobile app, extension, or device.
   *
   * Pass the user's existing session so a token refresh continues the conversation instead of
   * restarting it. Build this refresh path on day one: a chat longer than the TTL is normal.
   */
  async mintEmbedToken(externalUserId: string, ttlSeconds = 3_600) {
    return this.client.createEmbedSession(this.spaceId, this.agentId, {
      externalUserId,
      sessionId: await this.sessions.get(externalUserId),
      ttlSeconds,
      mode: this.defaultMode,
    });
  }

  /** Mint a hosted iframe URL. Iframe exactly what comes back, hash fragment included. */
  async mintEmbedUrl(externalUserId: string, displayName?: string, ttlSeconds = 3_600) {
    return this.client.createEmbedUrl(this.spaceId, this.agentId, {
      externalUserId,
      displayName,
      ttlSeconds,
      mode: this.defaultMode,
    });
  }
}

// ── Provisioning ─────────────────────────────────────────────────────────────

/** The name the Developer Center gives the Developer Space when API Claws is enabled. */
export const DEVELOPER_SPACE_DEFAULT_NAME = "API Claws";

/** Provisioning cannot continue without something only the account owner can do. */
export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisioningError";
  }
}

/**
 * Pick the Space the agent runs in.
 *
 * API Claws agents belong in the Developer Space: the Space the Developer Center creates when you
 * enable API Claws, which holds the API Claws credit balance. It is separate from your personal
 * workspace, so this never calls POST /spaces (that creates ordinary workspaces).
 */
export const resolveDeveloperSpace = (
  spaces: Space[],
  options: { spaceId?: string; developerCenterUrl: string },
): Space => {
  if (options.spaceId) {
    const chosen = spaces.find((space) => space.id === options.spaceId);
    if (!chosen) {
      throw new ProvisioningError(
        `Space ${options.spaceId} is not one this API key can use. ` +
          `Spaces it can use: ${spaces.map((space) => `${space.id} (${space.name})`).join(", ") || "none"}.`,
      );
    }
    return chosen;
  }

  // Servers that predate `kind` do not report it at all. There, fall back to the name the
  // Developer Center gives the Space it creates.
  const serverReportsKind = spaces.some((space) => space.kind !== undefined);
  const developerSpaces = serverReportsKind
    ? spaces.filter((space) => space.kind === "developer")
    : spaces.filter((space) => space.name === DEVELOPER_SPACE_DEFAULT_NAME);
  if (developerSpaces.length === 1 && developerSpaces[0]) return developerSpaces[0];
  if (developerSpaces.length === 0) {
    throw new ProvisioningError(
      "This account has no API Claws Developer Space yet. Open the Developer Center " +
        `(${options.developerCenterUrl}), enable API Claws, top up its credits, then re-run.`,
    );
  }
  throw new ProvisioningError(
    "This account has more than one Developer Space. Set QUICKSTART_SPACE_ID to one of: " +
      developerSpaces.map((space) => `${space.id} (${space.name})`).join(", "),
  );
};

/**
 * Find or create the agent in the Developer Space.
 *
 * Matching the agent by name keeps the quickstart safely re-runnable. Real provisioning keys off
 * YOUR customer record and stores the returned IDs, so a retried deploy never creates twice.
 */
export const provisionAgent = async (
  client: ProvisioningClient,
  input: {
    spaceId?: string;
    developerCenterUrl: string;
    agentName: string;
    instructions: string;
    emoji?: string;
  },
): Promise<{ space: Space; agent: ClawAgent; created: boolean }> => {
  const { spaces } = await client.listSpaces();
  const space = resolveDeveloperSpace(spaces, input);

  const { agents } = await client.listAgents(space.id);
  const existingAgent = agents.find((agent) => agent.name === input.agentName);
  if (existingAgent) return { space, agent: existingAgent, created: false };

  const agent = await client.createAgent({
    spaceId: space.id,
    name: input.agentName,
    emoji: input.emoji,
    instructions: input.instructions,
  });
  return { space, agent, created: true };
};
