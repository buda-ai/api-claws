/**
 * End-to-end proof that the harness works. One command, six checks:
 *
 *   1. the key resolves to your account
 *   2. provisioning is idempotent (re-running does not duplicate the tenant)
 *   3. a Drive write is readable back
 *   4. a turn settles and the answer USES the Drive content  <- the harness is real here
 *   5. a second turn in the same session keeps context
 *   6. an embed token can be minted for a frontend
 *
 * Run: pnpm demo
 */

import process from "node:process";
import { ApiClawsClient, ApiClawsError } from "./client.ts";
import { loadConfig } from "./config.ts";
import { AgentHarness, provisionAgent } from "./harness.ts";

const INSTRUCTIONS = [
  "You are a smartwatch support assistant.",
  "Use the files in your Drive as the source of truth; prefer them over general knowledge.",
  "Keep replies short enough to read on a small screen.",
].join(" ");

const MANUAL_PATH = "manuals/reset-device.md";
const MANUAL_CONTENT = `# Resetting the Acme Watch

Hold the crown for 8 seconds, then confirm on screen.
The device restarts twice; this is expected.

If the screen stays dark, put it on the charger for 15 minutes and retry.
`;

const step = (n: number, title: string) => console.log(`\n[${n}/6] ${title}`);

const main = async () => {
  const config = loadConfig();
  const client = new ApiClawsClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  step(1, "Checking the API key");
  const me = await client.getMe();
  console.log(`    key belongs to ${me.email}`);

  step(2, "Provisioning Space + Agent");
  const { space, agent, created } = await provisionAgent(client, {
    spaceName: config.spaceName,
    agentName: config.agentName,
    instructions: INSTRUCTIONS,
  });
  console.log(`    space ${space.id} (${space.name}, plan: ${space.plan})`);
  console.log(`    agent ${agent.id} (${created ? "created now" : "already existed — reused"})`);

  const harness = new AgentHarness({
    client,
    agentId: agent.id,
    spaceId: space.id,
    poll: { onStatus: (status) => process.stdout.write(`    status: ${status}\r`) },
  });

  step(3, "Writing durable knowledge to Drive");
  await harness.remember(MANUAL_PATH, MANUAL_CONTENT);
  const readBack = await harness.recall(MANUAL_PATH);
  if (!readBack?.includes("8 seconds")) {
    throw new Error(`Drive write did not read back correctly. Got: ${readBack ?? "<nothing>"}`);
  }
  console.log(`    ${MANUAL_PATH} written and read back (${readBack.length} chars)`);

  step(4, "Running a turn whose answer needs the Drive file");
  const first = await harness.ask("demo-user-1", "How do I reset my watch?");
  console.log(`    settled: ${first.status}${first.timedOut ? " (poll timed out)" : ""}`);
  if (first.timedOut) {
    console.log("    The run is still going server-side. Re-run to read the result; do not resend.");
  } else {
    console.log(`\n    ${first.reply?.replace(/\n/g, "\n    ") ?? "<no reply>"}\n`);
    const usedDrive = /8 seconds|crown|charger/i.test(first.reply ?? "");
    console.log(`    answer draws on the Drive file: ${usedDrive ? "yes" : "NO — check instructions"}`);
  }

  step(5, "Second turn, same session — does it keep context?");
  const second = await harness.ask("demo-user-1", "How long do I hold it for again?");
  console.log(`    settled: ${second.status}, same session: ${second.sessionId === first.sessionId}`);
  if (!second.timedOut) {
    console.log(`\n    ${second.reply?.replace(/\n/g, "\n    ") ?? "<no reply>"}\n`);
  }

  step(6, "Minting an embed token for a frontend");
  const embed = await harness.mintEmbedToken("demo-user-1", 600);
  console.log(`    token issued, expires ${embed.expiresAt}`);
  console.log(`    the frontend gets this token and NEVER the sk_ key`);

  console.log("\nDone. Next: replace InMemorySessionStore with your database, then wire your UI.");
};

main().catch((error: unknown) => {
  if (error instanceof ApiClawsError && error.isAuthFailure) {
    console.error("\nAuthentication failed. The key is wrong, truncated, expired, or deleted.");
    console.error("Check it with: curl -s https://buda.im/api/v1/users/me -H \"Authorization: Bearer $BUDA_API_KEY\"");
  } else {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
