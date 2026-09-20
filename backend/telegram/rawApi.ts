/**
 * Thin wrapper around the raw Telegram Bot API for the calls the
 * human-in-the-loop draft/approval flow needs beyond a plain send:
 * inline keyboards, editing messages, answering button presses, and
 * polling for updates. Kept separate from tools/sendTelegramMessage.ts
 * so the already-working send tool is never touched.
 */

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number };
  text?: string;
  reply_to_message?: { message_id: number };
  from?: { id: number; username?: string };
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "your_token_here") {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured. Set it in your .env file."
    );
  }
  return token;
}

/** Strips the bot token out of any string before it can leak into logs or errors. */
function redactToken(token: string, text: string): string {
  return token ? text.split(token).join("[REDACTED]") : text;
}

async function callTelegramApi<T>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const token = getToken();
  const url = `https://api.telegram.org/bot${token}/${method}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    throw new Error(redactToken(token, `Telegram request failed: ${text}`));
  }

  const data = (await response.json()) as {
    ok: boolean;
    description?: string;
    result?: T;
  };

  if (!response.ok || !data.ok) {
    throw new Error(
      redactToken(
        token,
        `Telegram API error (${method}): ${
          data.description ?? response.statusText
        }`
      )
    );
  }

  return data.result as T;
}

export function tgSendMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<TelegramMessage> {
  return callTelegramApi<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
}

export function tgEditMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup: InlineKeyboardMarkup = { inline_keyboard: [] }
): Promise<TelegramMessage> {
  return callTelegramApi<TelegramMessage>("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup,
  });
}

export function tgEditMessageReplyMarkup(
  chatId: string | number,
  messageId: number,
  replyMarkup: InlineKeyboardMarkup = { inline_keyboard: [] }
): Promise<TelegramMessage> {
  return callTelegramApi<TelegramMessage>("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

export function tgAnswerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<true> {
  return callTelegramApi<true>("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export function tgGetUpdates(
  offset: number,
  timeoutSeconds: number
): Promise<TelegramUpdate[]> {
  return callTelegramApi<TelegramUpdate[]>("getUpdates", {
    offset,
    timeout: timeoutSeconds,
    allowed_updates: ["message", "callback_query"],
  });
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** Raw `getMe` call — who this bot is, per Telegram. Prefer `getBotUsername()` below, which caches. */
export function tgGetMe(): Promise<TelegramBotInfo> {
  return callTelegramApi<TelegramBotInfo>("getMe", {});
}

// The bot's own @username never changes at runtime, so it's fetched from Telegram at most once per
// process and reused after that — cached only on success, so a transient failure (e.g. the token
// isn't configured yet, or a network blip) doesn't get "stuck" and can be retried on the next call.
let cachedBotUsername: string | null = null;

/**
 * The bot's own @username, straight from Telegram's `getMe` (never hardcoded/guessed) — lets the
 * frontend build a real "search @BotUsername" instruction and a working https://t.me/BotUsername
 * link. Returns null if TELEGRAM_BOT_TOKEN isn't configured or the call fails.
 */
export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await tgGetMe();
    if (me.username) cachedBotUsername = me.username;
    return me.username ?? null;
  } catch (error) {
    console.error("Failed to fetch bot username via getMe:", error);
    return null;
  }
}
