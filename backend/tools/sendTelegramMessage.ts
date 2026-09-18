import { z } from "zod";

export const sendTelegramMessageInputSchema = z.object({
  chatId: z
    .union([z.string(), z.number()])
    .describe("Telegram chat ID to send the message to"),
  message: z.string().min(1).describe("Text content of the message to send"),
  confirm: z
    .boolean()
    .describe(
      "Safety check. Must be explicitly set to true or no Telegram request will be made."
    ),
});

export type SendTelegramMessageInput = z.infer<
  typeof sendTelegramMessageInputSchema
>;

export interface SendTelegramMessageResult {
  success: boolean;
  message: string;
  messageId?: number;
}

/**
 * Removes the bot token from a string so it can never leak into
 * tool output, logs, or error messages.
 */
function redactToken(token: string, text: string): string {
  return token ? text.split(token).join("[REDACTED]") : text;
}

export async function sendTelegramMessage(
  input: SendTelegramMessageInput
): Promise<SendTelegramMessageResult> {
  const { chatId, message, confirm } =
    sendTelegramMessageInputSchema.parse(input);

  if (!confirm) {
    return {
      success: false,
      message:
        "Aborted: confirm was false. No Telegram request was made.",
    };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token || token === "your_token_here") {
    return {
      success: false,
      message:
        "TELEGRAM_BOT_TOKEN is not configured. Set it in your .env file.",
    };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });

    const data = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: { message_id: number };
    };

    if (!response.ok || !data.ok) {
      return {
        success: false,
        message: redactToken(
          token,
          `Telegram API error: ${data.description ?? response.statusText}`
        ),
      };
    }

    return {
      success: true,
      message: "Message sent successfully.",
      messageId: data.result?.message_id,
    };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: redactToken(token, `Failed to send message: ${errorText}`),
    };
  }
}
