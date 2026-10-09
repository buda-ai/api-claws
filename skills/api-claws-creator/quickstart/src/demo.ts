/**
 * End-to-end proof that the harness works. One command, six checks, and any failed check stops
 * the demo with exit code 1:
 *
 *   1. the key resolves to your account
 *   2. the API Claws Developer Space is found, and the Agent found or created (re-runs reuse it)
 *   3. a Drive write reads back unchanged
 *   4. a turn completes and the answer USES the Drive content  <- the harness is real here
 *   5. a second turn runs in the same session and remembers what was said in the first
 *   6. an embed token is minted for that same session
 *
 * If step 4 is still running when polling gives up, the demo stops there. It never posts the
 * step-5 message into a session whose previous run may still be going.
 *
 * Run: pnpm demo
 */

import process from "node:process";
import { ApiClawsClient, ApiClawsError } from "./client.ts";
import { loadConfig } from "./config.ts";
import { DemoCheckFailed, runDemo } from "./demo-flow.ts";

const main = async () => {
  const config = loadConfig();
  const client = new ApiClawsClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  try {
    await runDemo({
      client,
      spaceId: config.spaceId,
      developerCenterUrl: config.developerCenterUrl,
      agentName: config.agentName,
      poll: {
        timeoutMs: config.pollTimeoutMs,
        onStatus: (status) => process.stdout.write(`    status: ${status.padEnd(20)}\r`),
      },
      log: (line) => console.log(line),
    });
  } catch (error: unknown) {
    if (error instanceof DemoCheckFailed) {
      console.error(`\n✗ Step ${error.step} failed: ${error.message}`);
    } else if (error instanceof ApiClawsError && error.isAuthFailure) {
      console.error("\n✗ Authentication failed. The key is wrong, truncated, expired, or deleted.");
      console.error(
        `  Check it with: curl -s ${config.baseUrl}/users/me -H "Authorization: Bearer $BUDA_API_KEY"`,
      );
    } else {
      console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }

  console.log("\nAll six checks passed.");
  console.log("Next: replace InMemorySessionStore with your database, then wire your UI.");
};

main().catch((error: unknown) => {
  // Config errors (missing key) land here, before any request is made.
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
