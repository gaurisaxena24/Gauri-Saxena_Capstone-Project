/**
 * Debt Info collector Agent.
 *
 * The orchestration layer between Telegram and the unhinged-debt-collector
 * Skill. It owns the multi-step loop: for every incoming Telegram message it
 * invokes the (Telegram-agnostic) Skill once, inspects the returned
 * `status`, and either sends the next question back over Telegram
 * ("collecting" — invoke the Skill again on the next message) or sends the
 * completion summary and stops ("complete"). The Skill itself never talks
 * to Telegram; this Agent is the only place that does, via the existing
 * tgSendMessage() wrapper in ../telegram/rawApi.ts.
 */

import { tgSendMessage, type TelegramMessage } from "../telegram/rawApi.js";
import {
  invokeDebtCollectorSkill,
  type DebtContextJSON,
} from "../skills/debtCollectorSkill.js";

const FORM_TEXT = `💸 UNHINGED DEBT COLLECTOR

Who are we financially chasing?

1. Person's name:

2. Person's Telegram details / username:

3. Amount owed:

4. What is the debt for?

5. How long has it been overdue?

6. Relationship with them:

7. Have you reminded them before? Yes/No
   - If yes, how many times?

8. Any additional context:`;

/**
 * Restricts the flow to the owner's own Telegram chat (TELEGRAM_REVIEWER_CHAT_ID,
 * the same "my chat" concept used by the draft/approval flow) when that variable
 * is configured, so a stranger who messages the bot can't trigger it.
 */
function isOwnerChat(chatId: string | number): boolean {
  const ownerChatId = process.env.TELEGRAM_REVIEWER_CHAT_ID;
  if (!ownerChatId) return true;
  return String(chatId) === String(ownerChatId);
}

function summarizeDebtContext(ctx: DebtContextJSON): string {
  const reminderLine = ctx.previously_reminded ? `Yes (${ctx.previous_reminder_count}x)` : "No";

  return (
    `Got it — here's what I've saved:\n\n` +
    `Person: ${ctx.person_name}\n` +
    `Telegram: ${ctx.telegram_username}\n` +
    `Amount owed: ${ctx.amount_owed}\n` +
    `Debt for: ${ctx.debt_reason}\n` +
    `Overdue: ${ctx.overdue_duration}\n` +
    `Relationship: ${ctx.relationship}\n` +
    `Previously reminded: ${reminderLine}\n` +
    `Additional context: ${ctx.additional_context || "-"}`
  );
}

/** Total Skill invocations across all chats, for this process's lifetime — evidence the loop is real. */
let skillInvocationCount = 0;

/**
 * Runs one step of the agent loop for a single incoming Telegram message.
 * Returns true if the message was consumed here (so the poller should not
 * also try to interpret it as a draft reply-edit), false otherwise.
 */
export async function runDebtCollectorAgentStep(message: TelegramMessage): Promise<boolean> {
  const chatId = message.chat.id;
  const text = message.text?.trim();
  if (!text) return false;
  if (!isOwnerChat(chatId)) return false;

  const result = invokeDebtCollectorSkill(chatId, text);
  if (!result) return false;

  skillInvocationCount += 1;
  console.log(
    `[DebtCollectorAgent] skill invocation #${skillInvocationCount} (chat ${chatId}): ` +
      `status=${result.status}` +
      (result.next_field ? `, next_field=${result.next_field}` : "")
  );

  if (result.justStarted) {
    await tgSendMessage(chatId, FORM_TEXT);
  }

  if (result.status === "complete") {
    console.log(`[DebtCollectorAgent] final debt_context (chat ${chatId}):`, JSON.stringify(result.debt_context, null, 2));
    await tgSendMessage(chatId, summarizeDebtContext(result.debt_context));
    return true;
  }

  const questionText = result.error ? `${result.error} ${result.next_question}` : result.next_question;
  if (questionText) {
    await tgSendMessage(chatId, questionText);
  }
  return true;
}
