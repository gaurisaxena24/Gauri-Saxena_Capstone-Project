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
import { ensureDatabaseReady } from "./database/database.js";
import { startReminderScheduler } from "./reminders/scheduler.js";
import { startGmailScanScheduler } from "./gmail/scanScheduler.js";

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

// The automatic reminder scheduler (backend/reminders/scheduler.ts) sends real Telegram messages
// on its own timer, with no human approval, for as long as a debt stays UNPAID — running it from
// more than one instance at once against the same database would double- or triple-send the exact
// same escalating follow-up to the same person. Same problem class as shouldPollTelegram() above,
// same fix: only the actually-deployed Railway instance runs it by default, with the equivalent
// local opt-in (ENABLE_REMINDER_SCHEDULER=true) for testing it from your own machine — only when
// you're sure nothing else (including the deployed instance) is also running it.
function shouldRunReminderScheduler(): boolean {
  return Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.ENABLE_REMINDER_SCHEDULER === "true";
}

async function main() {
  try {
    await ensureDatabaseReady();
    console.log("[db] Connected to Postgres and schema is up to date.");
  } catch (error) {
    console.error("[db] Failed to connect to Postgres — check DATABASE_URL:", error);
    process.exit(1);
  }

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
  if (shouldRunReminderScheduler()) {
    startReminderScheduler();
  } else {
    console.log(
      "[reminder-scheduler] Skipping the automatic reminder scheduler on this instance (not Railway, " +
        "ENABLE_REMINDER_SCHEDULER not set) so it doesn't double-send follow-ups alongside the deployed instance. " +
        "Manually sending a debt's first reminder still works normally."
    );
  }
  // Same "only one process may act" reasoning as shouldRunReminderScheduler() above — reuses its
  // exact activation gate rather than inventing a second one, since running this scanner on both a
  // local dev instance and the deployed instance at once would just be wasteful double-processing,
  // not a correctness problem (gmail_processed_messages dedupes either way).
  if (shouldRunReminderScheduler()) {
    startGmailScanScheduler();
  } else {
    console.log(
      "[gmail-scan] Skipping the Gmail payment scanner on this instance (not Railway, " +
        "ENABLE_REMINDER_SCHEDULER not set)."
    );
  }
  startApiServer();
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
