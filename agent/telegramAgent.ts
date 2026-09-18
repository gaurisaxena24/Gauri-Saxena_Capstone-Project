/**
 * Telegram Agent — the addressable interface debtCollectorAgent (Main Agent)
 * calls to actually send. Delegates to skills/telegramSkill.ts, which uses
 * the existing Telegram MCP tool (backend/tools/sendTelegramMessage.ts) and
 * only sends to a person once their Telegram identity is genuinely
 * verified. Never generates or edits a message — it sends exactly the
 * approved text it's given.
 */

import { sendApprovedMessage, TelegramNotVerifiedError, type SendResult } from "../skills/telegramSkill.js";
import type { Person } from "../backend/database/database.js";

export { TelegramNotVerifiedError };
export type { SendResult };

export function sendMessage(person: Person, message: string): Promise<SendResult> {
  return sendApprovedMessage(person, message);
}
