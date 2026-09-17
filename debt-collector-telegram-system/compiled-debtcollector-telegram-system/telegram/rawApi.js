/**
 * Thin wrapper around the raw Telegram Bot API for the calls the
 * human-in-the-loop draft/approval flow needs beyond a plain send:
 * inline keyboards, editing messages, answering button presses, and
 * polling for updates. Kept separate from tools/sendTelegramMessage.ts
 * so the already-working send tool is never touched.
 */
function getToken() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token === "your_token_here") {
        throw new Error("TELEGRAM_BOT_TOKEN is not configured. Set it in your .env file.");
    }
    return token;
}
/** Strips the bot token out of any string before it can leak into logs or errors. */
function redactToken(token, text) {
    return token ? text.split(token).join("[REDACTED]") : text;
}
async function callTelegramApi(method, params) {
    const token = getToken();
    const url = `https://api.telegram.org/bot${token}/${method}`;
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
    }
    catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        throw new Error(redactToken(token, `Telegram request failed: ${text}`));
    }
    const data = (await response.json());
    if (!response.ok || !data.ok) {
        throw new Error(redactToken(token, `Telegram API error (${method}): ${data.description ?? response.statusText}`));
    }
    return data.result;
}
export function tgSendMessage(chatId, text, replyMarkup) {
    return callTelegramApi("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: replyMarkup,
    });
}
export function tgEditMessageText(chatId, messageId, text, replyMarkup = { inline_keyboard: [] }) {
    return callTelegramApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: replyMarkup,
    });
}
export function tgEditMessageReplyMarkup(chatId, messageId, replyMarkup = { inline_keyboard: [] }) {
    return callTelegramApi("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: replyMarkup,
    });
}
export function tgAnswerCallbackQuery(callbackQueryId, text) {
    return callTelegramApi("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text,
    });
}
export function tgGetUpdates(offset, timeoutSeconds) {
    return callTelegramApi("getUpdates", {
        offset,
        timeout: timeoutSeconds,
        allowed_updates: ["message", "callback_query"],
    });
}
