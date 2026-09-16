import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  sendTelegramMessage,
  sendTelegramMessageInputSchema,
} from "./tools/sendTelegramMessage.js";

const server = new McpServer({
  name: "unhinged-debt-collector-mcp-server",
  version: "0.1.0",
});

server.tool(
  "send_telegram_message",
  "Send a text message to a Telegram chat via the Telegram Bot API.",
  sendTelegramMessageInputSchema.shape,
  async (input) => {
    const result = await sendTelegramMessage(input);
    return {
      content: [{ type: "text", text: result.message }],
      isError: !result.success,
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
