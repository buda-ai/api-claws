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
import { AgentHarness, provisionAgent, type TurnResult } from "./harness.ts";

const USER_ID = "terminal-user";

const main = async () => {
  const config = loadConfig();
  const client = new ApiClawsClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  const { space, agent } = await provisionAgent(client, {
    spaceId: config.spaceId,
    developerCenterUrl: config.developerCenterUrl,
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
  const prompt = () => process.stdout.write("you> ");

  const show = (result: TurnResult) => {
    process.stdout.write("           \r");
    if (result.timedOut) {
      console.log(
        "agent> (still working — its reply will show before your next message is sent)\n",
      );
      return;
    }
    switch (result.status) {
      case "waiting_for_input":
        // A settled state, not a failure: the agent asked YOU something. Answer it in the
        // same session and the run continues.
        console.log(`agent> ${result.reply ?? "(waiting for your input)"}\n`);
        break;
      case "failed":
        // The server says why: API_CLAW_CREDITS_EXHAUSTED means the Developer Space needs a top-up.
        console.log(
          result.error
            ? `agent> (the run failed — ${result.error.code}: ${result.error.message})\n`
            : "agent> (the run failed — try rephrasing, or check the dashboard)\n",
        );
        break;
      case "cancelled":
        console.log("agent> (the run was cancelled)\n");
        break;
      default:
        console.log(`agent> ${result.reply ?? "(no reply)"}\n`);
    }
  };

  // A run that outlived the poll deadline is still going. Never post into its session until it
  // settles — that would start a second run.
  let stillRunning: string | undefined;

  try {
    prompt();
    // The async iterator buffers lines typed (or piped) while a turn is running, and ends
    // cleanly on Ctrl+D / end of input.
    for await (const raw of rl) {
      const line = raw.trim();
      if (line === "/quit") break;
      if (!line) {
        prompt();
        continue;
      }
      if (line === "/new") {
        await harness.endConversation(USER_ID);
        stillRunning = undefined;
        console.log("Started a fresh session — the agent will not remember the previous turns.\n");
        prompt();
        continue;
      }

      if (stillRunning) {
        const late = await harness.waitForReply(stillRunning);
        show(late);
        if (late.timedOut) {
          console.log("(your message was not sent — the previous reply is still in progress)\n");
          prompt();
          continue;
        }
        stillRunning = undefined;
      }

      const result = await harness.ask(USER_ID, line);
      show(result);
      if (result.timedOut) stillRunning = result.sessionId;
      prompt();
    }
    console.log();
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
