import { config } from "dotenv";
import { resolve } from "node:path";
import { findProjectRoot } from "./paths.js";

// .env lives at the project root. Found by walking up to package.json rather
// than a fixed number of `../` segments, so it resolves correctly whether
// this runs from source (tsx) or compiled output, and no matter what working
// directory the MCP host launches this server from.
const PROJECT_ROOT = findProjectRoot(import.meta.url);
config({ path: resolve(PROJECT_ROOT, ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  sendTelegramMessage,
  sendTelegramMessageInputSchema,
} from "./tools/sendTelegramMessage.js";
import {
  createDebtReminderDraft,
  createDebtReminderDraftInputSchema,
} from "./tools/createDebtReminderDraft.js";
import {
  getDraftStatus,
  getDraftStatusInputSchema,
} from "./tools/getDraftStatus.js";
import { startTelegramPoller } from "./telegram/poller.js";
import { startApiServer } from "./api/server.js";

const server = new McpServer({
  name: "unhinged-debt-collector-mcp-server",
  version: "0.1.0",
});

server.tool(
  "send_telegram_message",
  "Send a text message to a Telegram chat via the Telegram Bot API. " +
    "Requires confirm=true; otherwise no request is sent.",
  sendTelegramMessageInputSchema.shape,
  async (input) => {
    const result = await sendTelegramMessage(input);
    const text =
      result.success && result.messageId !== undefined
        ? `${result.message} (message_id: ${result.messageId})`
        : result.message;
    return {
      content: [{ type: "text", text }],
      isError: !result.success,
    };
  }
);

server.tool(
  "create_debt_reminder_draft",
  "Generate a debt reminder draft and send it to the reviewer's Telegram chat for " +
    "human approval. This NEVER sends anything to the final recipient by itself — " +
    "it only creates a draft awaiting explicit approval via Telegram buttons.",
  createDebtReminderDraftInputSchema.shape,
  async (input) => {
    const result = await createDebtReminderDraft(input);
    const text = result.draftId
      ? `${result.message}\n\ndraftId: ${result.draftId}\ndraft text: ${result.draftText}`
      : result.message;
    return {
      content: [{ type: "text", text }],
      isError: !result.success,
    };
  }
);

server.tool(
  "get_draft_status",
  "Check the status of a debt reminder draft (pending / approved / rejected) and, " +
    "once approved, the exact text that was approved and whether it was sent.",
  getDraftStatusInputSchema.shape,
  async (input) => {
    const result = getDraftStatus(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.found,
    };
  }
);

// Telegram only allows ONE active getUpdates connection per bot token — running the poller in
// both a local dev server and the deployed Railway instance at the same time makes them fight
// over it, and whichever one wins a given poll cycle processes that update against ITS OWN
// database. In practice this silently verified people in a local throwaway database while the
// real, deployed site never saw it. Railway sets RAILWAY_ENVIRONMENT at runtime; local dev never
// has it, so by default only the actually-deployed instance polls. Set ENABLE_TELEGRAM_POLLER=true
// locally to explicitly opt in when you really do need to test the live poller from your machine —
// but only when you're sure nothing else (including the deployed instance) is also polling it.
function shouldPollTelegram(): boolean {
  return Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.ENABLE_TELEGRAM_POLLER === "true";
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (shouldPollTelegram()) {
    void startTelegramPoller();
  } else {
    console.log(
      "[telegram] Skipping the Telegram poller on this instance (not Railway, ENABLE_TELEGRAM_POLLER not set) " +
        "so it doesn't fight the deployed instance for the bot's single connection. Sending messages still works normally."
    );
  }
  startApiServer();
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
