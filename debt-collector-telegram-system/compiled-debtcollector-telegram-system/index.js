import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// .env lives at the project root, one level above mcp-server/. Resolve it
// relative to this file (not process.cwd()) so the token loads correctly
// no matter what working directory the MCP host launches this server from.
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sendTelegramMessage, sendTelegramMessageInputSchema, } from "./tools/sendTelegramMessage.js";
import { createDebtReminderDraft, createDebtReminderDraftInputSchema, } from "./tools/createDebtReminderDraft.js";
import { getDraftStatus, getDraftStatusInputSchema, } from "./tools/getDraftStatus.js";
import { startTelegramPoller } from "./telegram/poller.js";
const server = new McpServer({
    name: "unhinged-debt-collector-mcp-server",
    version: "0.1.0",
});
server.tool("send_telegram_message", "Send a text message to a Telegram chat via the Telegram Bot API. " +
    "Requires confirm=true; otherwise no request is sent.", sendTelegramMessageInputSchema.shape, async (input) => {
    const result = await sendTelegramMessage(input);
    const text = result.success && result.messageId !== undefined
        ? `${result.message} (message_id: ${result.messageId})`
        : result.message;
    return {
        content: [{ type: "text", text }],
        isError: !result.success,
    };
});
server.tool("create_debt_reminder_draft", "Generate a debt reminder draft and send it to the reviewer's Telegram chat for " +
    "human approval. This NEVER sends anything to the final recipient by itself — " +
    "it only creates a draft awaiting explicit approval via Telegram buttons.", createDebtReminderDraftInputSchema.shape, async (input) => {
    const result = await createDebtReminderDraft(input);
    const text = result.draftId
        ? `${result.message}\n\ndraftId: ${result.draftId}\ndraft text: ${result.draftText}`
        : result.message;
    return {
        content: [{ type: "text", text }],
        isError: !result.success,
    };
});
server.tool("get_draft_status", "Check the status of a debt reminder draft (pending / approved / rejected) and, " +
    "once approved, the exact text that was approved and whether it was sent.", getDraftStatusInputSchema.shape, async (input) => {
    const result = getDraftStatus(input);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.found,
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    void startTelegramPoller();
}
main().catch((error) => {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
});
