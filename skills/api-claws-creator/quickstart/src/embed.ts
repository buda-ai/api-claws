/**
 * The credential boundary, demonstrated.
 *
 * Your backend holds the sk_ key and mints short-lived, per-user tokens. The frontend — browser,
 * mini program, mobile app, extension, device — holds only the token.
 *
 * Run: pnpm embed
 */

import process from "node:process";
import { ApiClawsClient, ApiClawsError } from "./client.ts";
import { loadConfig } from "./config.ts";
import { AgentHarness, provisionAgent } from "./harness.ts";

const END_USER = "customer-123";

const main = async () => {
  const config = loadConfig();
  const client = new ApiClawsClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  const { space, agent } = await provisionAgent(client, {
    spaceName: config.spaceName,
    agentName: config.agentName,
    instructions: "You are a helpful assistant. Use your Drive files as the source of truth.",
  });

  const harness = new AgentHarness({ client, agentId: agent.id, spaceId: space.id });

  // ── Option A: hosted iframe. Buda renders the chat UI; you render nothing. ──
  const hosted = await harness.mintEmbedUrl(END_USER, "Kelly", 3_600);
  console.log("Option A — hosted iframe UI\n");
  console.log(`  <iframe src="${hosted.embedUrl}"`);
  console.log('          title="Agent" allow="microphone"');
  console.log('          style="width:400px;height:600px;border:0"></iframe>\n');
  console.log(`  expires ${hosted.expiresAt}`);
  console.log("  Iframe this URL verbatim — the token is in the hash fragment, so it is never");
  console.log("  sent to a server with the page request. Strip the fragment and it stops working.\n");

  // ── Option B: your own UI. You get a token; you render the chat. ────────────
  const embedSession = await harness.mintEmbedToken(END_USER, 3_600);
  console.log("Option B — your own UI (mini program, mobile app, extension)\n");
  console.log("  Send to the frontend, and nothing else:");
  console.log(
    JSON.stringify(
      {
        token: `${embedSession.token.slice(0, 12)}…`,
        sessionId: embedSession.sessionId,
        api: embedSession.api,
        expiresAt: embedSession.expiresAt,
      },
      null,
      2,
    )
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
  );
  console.log("\n  The frontend then calls, with the token as its bearer:");
  console.log(`    POST ${config.baseUrl}/embed/chat-sessions/${embedSession.sessionId}/messages`);
  console.log(`    GET  ${config.baseUrl}/embed/chat-sessions/${embedSession.sessionId}`);

  console.log("\nRefresh, before you ship:");
  console.log("  When the frontend sees an auth failure, ask YOUR backend for a new token and");
  console.log("  pass the same sessionId back into the mint call. Without this, every chat");
  console.log("  longer than the TTL dies at exactly the same elapsed time.");
};

main().catch((error: unknown) => {
  if (error instanceof ApiClawsError && error.isAuthFailure) {
    console.error("\nAuthentication failed — check BUDA_API_KEY.");
  } else {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
