/**
 * An interactive terminal chat against your provisioned agent.
 *
 * This is the turn loop with a human in it: type, watch the poll, read the reply, type again —
 * all in one session, so you can see for yourself that context carries.
 *
 * Run: pnpm chat
 */

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { ApiClawsClient, ApiClawsError } from "./client.ts";
import { loadConfig } from "./config.ts";
import { AgentHarness, provisionAgent } from "./harness.ts";

const USER_ID = "terminal-user";

const main = async () => {
  const config = loadConfig();
  const client = new ApiClawsClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  const { space, agent } = await provisionAgent(client, {
    spaceName: config.spaceName,
    agentName: config.agentName,
    instructions: "You are a helpful assistant. Use your Drive files as the source of truth.",
  });

  const harness = new AgentHarness({
    client,
    agentId: agent.id,
    spaceId: space.id,
    poll: { onStatus: (status) => process.stdout.write(`  ...${status}\r`) },
  });

  console.log(`Talking to ${agent.name} in ${space.name}.`);
  console.log("Type a message. /new starts a fresh session, /quit exits.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      const line = (await rl.question("you> ")).trim();
      if (!line) continue;
      if (line === "/quit") break;
      if (line === "/new") {
        await harness.endConversation(USER_ID);
        console.log("Started a fresh session — the agent will not remember the previous turns.\n");
        continue;
      }

      const result = await harness.ask(USER_ID, line);
      process.stdout.write("           \r");

      if (result.timedOut) {
        console.log("agent> (still working — ask again in a moment; do not resend this message)\n");
        continue;
      }

      switch (result.status) {
        case "waiting_for_input":
          // A settled state, not a failure: the agent asked YOU something. Answer it in the
          // same session and the run continues.
          console.log(`agent> ${result.reply ?? "(waiting for your input)"}\n`);
          break;
        case "failed":
          console.log("agent> (the run failed — try rephrasing, or check the dashboard)\n");
          break;
        case "cancelled":
          console.log("agent> (the run was cancelled)\n");
          break;
        default:
          console.log(`agent> ${result.reply ?? "(no reply)"}\n`);
      }
    }
  } finally {
    rl.close();
  }
};

main().catch((error: unknown) => {
  if (error instanceof ApiClawsError && error.isAuthFailure) {
    console.error("\nAuthentication failed — check BUDA_API_KEY.");
  } else {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
