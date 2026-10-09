/**
 * A minimal, dependency-free client for the API Claws REST surface.
 *
 * Only the endpoints a harness actually needs are here. The full surface is at
 * https://buda.im/api/v1/openapi.json — add methods the same way when you need more.
 */

export const DEFAULT_BASE_URL = "https://buda.im/api/v1";

export type SessionStatus =
  | "pending"
  | "in_progress"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled";

/** The four states a run can end in. `waiting_for_input` is settled, not a failure. */
export const SETTLED_STATUSES: readonly SessionStatus[] = [
  "completed",
  "waiting_for_input",
  "failed",
  "cancelled",
];

export type PromptMode = "agent" | "chat" | "thinking" | "build-app";

export interface Space {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  plan: string;
  role: string;
  /**
   * "developer" = the API Claws Developer Space from the Developer Center; it holds the credits.
   * Absent on older servers — see resolveDeveloperSpace for the fallback.
   */
  kind?: "workspace" | "developer";
  createdAt: string;
}

export interface ClawAgent {
  id: string;
  nodeId: string;
  spaceId: string;
  name: string;
  emoji: string;
  driveId: string | null;
  status: "idle" | "working" | "waiting_for_input" | "alert" | "disabled";
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DriveFile {
  path: string;
  name: string;
  type: "file" | "folder";
  size: number;
  mimeType: string | null;
  updatedAt: string;
}

export interface ChatSession {
  id: string;
  agentId: string;
  spaceId: string;
  title: string;
  status: SessionStatus;
  promptMode: PromptMode | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Why the run failed, when status is "failed" — e.g. API_CLAW_CREDITS_EXHAUSTED. */
  error: { code: string; message: string } | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface SessionDetail {
  session: ChatSession;
  messages: ChatMessage[];
  run: { status: SessionStatus; streamUrl: string; cancelUrl: string };
}

export interface StartedRun {
  session: ChatSession;
  run: { started: boolean; statusUrl: string };
}

export interface EmbedSession {
  token: string;
  embedUrl: string;
  sessionId: string;
  agentId: string;
  spaceId: string;
  expiresAt: string;
  api: { statusUrl: string; messagesUrl: string };
}

export type EmbedUrl = Omit<EmbedSession, "token">;

export interface MintEmbedInput {
  externalUserId: string;
  displayName?: string;
  /** Pass an existing session to keep the conversation across token refreshes. */
  sessionId?: string;
  /** 60–86400 seconds. */
  ttlSeconds?: number;
  mode?: PromptMode;
  metadata?: Record<string, unknown>;
}

export interface SendMessageInput {
  message: string;
  title?: string;
  mode?: PromptMode;
  model?: string;
  startRun?: boolean;
}

/** An error carrying enough context to tell a bad key apart from a bad ID. */
export class ApiClawsError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} failed with ${status}: ${body || "<empty body>"}`);
    this.name = "ApiClawsError";
  }

  /** 401 means the key is wrong or expired; nothing downstream will work until it is fixed. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

export interface ApiClawsClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class ApiClawsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: ApiClawsClientOptions) {
    if (!options.apiKey) throw new Error("An API key is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new ApiClawsError(response.status, method, path, await response.text());
    }
    return (await response.json()) as T;
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  /** The first call to make. Proves the key resolves to the account you expect. */
  getMe(): Promise<{ id: string; name: string; email: string; createdAt: string }> {
    return this.request("GET", "/users/me");
  }

  // ── Tenancy ────────────────────────────────────────────────────────────────

  listSpaces(): Promise<{ spaces: Space[]; total: number }> {
    return this.request("GET", "/spaces");
  }

  createSpace(input: { name: string; slug?: string; logo?: string }): Promise<Space> {
    return this.request("POST", "/spaces", input);
  }

  // ── Agents ─────────────────────────────────────────────────────────────────

  listAgents(spaceId: string): Promise<{ agents: ClawAgent[]; total: number }> {
    return this.request("GET", `/spaces/${spaceId}/agents`);
  }

  createAgent(input: {
    spaceId: string;
    name: string;
    emoji?: string;
    instructions?: string;
    storageType?: "s3" | "ebs";
  }): Promise<ClawAgent> {
    return this.request("POST", "/api-agents", input);
  }

  // ── Drive (durable memory) ─────────────────────────────────────────────────

  listDriveFiles(agentId: string, path?: string): Promise<{ files: DriveFile[]; total: number }> {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return this.request("GET", `/api-agents/${agentId}/drive/files${query}`);
  }

  putDriveFile(
    agentId: string,
    input: { path: string; content: string; mimeType?: string },
  ): Promise<{ success: boolean; file: DriveFile }> {
    return this.request("PUT", `/api-agents/${agentId}/drive/files`, input);
  }

  readDriveText(
    agentId: string,
    filePath: string,
    maxBytes?: number,
  ): Promise<{
    content: string;
    exists: boolean;
    isText: boolean;
    tooLarge: boolean;
    sizeBytes: number;
  }> {
    return this.request("POST", `/api-agents/${agentId}/drive/text`, { filePath, maxBytes });
  }

  // ── Sessions (conversation) ────────────────────────────────────────────────

  /** Creates a NEW session. Use sendMessage() to continue an existing one. */
  createSession(agentId: string, input: SendMessageInput): Promise<StartedRun> {
    return this.request("POST", `/api-agents/${agentId}/sessions`, input);
  }

  sendMessage(agentId: string, sessionId: string, input: SendMessageInput): Promise<StartedRun> {
    return this.request("POST", `/api-agents/${agentId}/sessions/${sessionId}/messages`, input);
  }

  getSession(agentId: string, sessionId: string): Promise<SessionDetail> {
    return this.request("GET", `/api-agents/${agentId}/sessions/${sessionId}`);
  }

  cancelRun(agentId: string, sessionId: string): Promise<{ ok: boolean; cancelled: boolean }> {
    return this.request("DELETE", `/api-agents/${agentId}/sessions/${sessionId}/run`);
  }

  // ── Embed (frontend-safe access) ───────────────────────────────────────────

  /** Mint a token for your own UI. The frontend gets the token, never the sk_ key. */
  createEmbedSession(
    spaceId: string,
    agentId: string,
    input: MintEmbedInput,
  ): Promise<EmbedSession> {
    return this.request("POST", `/spaces/${spaceId}/agents/${agentId}/embed-sessions`, input);
  }

  /** Mint a hosted iframe URL. Iframe exactly what comes back, hash fragment included. */
  createEmbedUrl(spaceId: string, agentId: string, input: MintEmbedInput): Promise<EmbedUrl> {
    return this.request("POST", `/spaces/${spaceId}/agents/${agentId}/embed-urls`, input);
  }
}
