/**
 * Telegram Skill — the only thing allowed to actually send. It never
 * generates or edits a message and never decides what to send; it sends
 * exactly the approved text it's given, to a person only once their
 * Telegram identity has been genuinely verified (see profileSkill /
 * backend/telegram/poller.ts — verification happens when the person
 * actually messages the bot, the only proof the Bot API can give).
 *
 * Uses the existing Telegram MCP tool (backend/tools/sendTelegramMessage.ts)
 * — no second Telegram sender is created.
 */

import { sendTelegramMessage } from "../backend/tools/sendTelegramMessage.js";
import type { Person } from "../backend/database/database.js";

export class TelegramNotVerifiedError extends Error {
  constructor(person: Person) {
    const label = person.telegram_username ? `@${person.telegram_username}` : person.name;
    // A contact with no stored Telegram username can only ever be verified via the one-time code
    // (there's no username for the poller to match an incoming message against), so the guidance
    // differs from the username case, where any incoming message auto-verifies them.
    const howTo = person.telegram_username
      ? `ask them to send any message (e.g. "hi") to the bot`
      : `ask them to send the verification code shown in the app to the bot`;
    super(`${label} hasn't verified their Telegram yet — ${howTo}, then try sending again.`);
    this.name = "TelegramNotVerifiedError";
  }
}

export interface SendResult {
  success: boolean;
  message: string;
  telegramMessageId?: number;
}

export async function sendApprovedMessage(person: Person, message: string): Promise<SendResult> {
  if (!person.telegram_verified || !person.telegram_chat_id) {
    throw new TelegramNotVerifiedError(person);
  }

  const result = await sendTelegramMessage({
    chatId: person.telegram_chat_id,
    message,
    confirm: true,
  });

  return { success: result.success, message: result.message, telegramMessageId: result.messageId };
}
