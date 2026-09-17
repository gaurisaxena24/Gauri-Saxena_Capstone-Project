/**
 * Debt Draft Agent.
 *
 * Owns the stage between "collector Skill finished" and "row saved to
 * SQLite": showing a preview with Save/Make Changes buttons, letting the
 * user edit fields in place without redoing the whole form, and only ever
 * inserting a database row once, on an explicit Save. All Telegram I/O
 * goes through the existing tgSendMessage/tgEditMessageText wrappers in
 * ../../backend/telegram/rawApi.ts; database access goes through ../../backend/database/database.ts.
 */

import {
  tgSendMessage,
  tgEditMessageText,
  tgAnswerCallbackQuery,
  type TelegramMessage,
  type TelegramCallbackQuery,
} from "../../backend/telegram/rawApi.js";
import type { DebtContextJSON } from "../../skills/debtCollector/debtCollectorSkill/debtCollectorSkill.js";
import {
  createDebtDraft,
  getDebtDraft,
  setDebtDraftLiveMessage,
  setDebtDraftStatus,
  updateDebtDraftFields,
  findAwaitingEditDraftByChat,
  type DebtDraftFields,
} from "../../backend/debtDraft/debtDraftStore.js";
import {
  formatDebtPreview,
  buildDebtPreviewKeyboard,
  formatEditableDraftText,
  formatSavedSuffix,
  parseEditedDraftText,
} from "../../backend/debtDraft/debtDraftFormat.js";
import { validateDebtDraft } from "../../backend/debtDraft/debtDraftValidation.js";
import { saveDebt } from "../../backend/database/database.js";

function debtContextToDraftFields(ctx: DebtContextJSON): DebtDraftFields {
  return {
    name: ctx.person_name ?? "",
    amount: ctx.amount_owed ?? "",
    reason: ctx.debt_reason ?? "",
    overdue_period: ctx.overdue_duration ?? "",
    relationship: ctx.relationship ?? "",
    prior_reminder: ctx.previously_reminded ? "Yes" : "No",
    context: ctx.additional_context ?? undefined,
    tone: ctx.tone ?? undefined,
  };
}

/** Called once the collector Skill reaches status "complete": starts the preview/approval stage. */
export async function startDebtDraftReview(
  chatId: string | number,
  debtContext: DebtContextJSON
): Promise<void> {
  const draft = createDebtDraft(chatId, debtContextToDraftFields(debtContext));
  const sent = await tgSendMessage(
    chatId,
    formatDebtPreview(draft.fields),
    buildDebtPreviewKeyboard(draft.draftId)
  );
  setDebtDraftLiveMessage(draft.draftId, sent.message_id);
}

/**
 * Handles a Save/Make Changes button press. Returns true if the callback
 * belonged to this flow (whether or not it needed further action), false if
 * it's for some other flow (e.g. the reminder-approval buttons) and the
 * caller should try its own handler instead.
 */
export async function handleDebtDraftCallback(cb: TelegramCallbackQuery): Promise<boolean> {
  if (!cb.data || !cb.message) return false;
  const [action, draftId] = cb.data.split(":");
  if (action !== "save_debt" && action !== "edit_debt") return false;

  const draft = getDebtDraft(draftId);
  if (!draft || draft.liveMessageId !== cb.message.message_id) {
    await answerSafely(cb.id, "This draft was already handled or has been superseded.");
    return true;
  }

  if (action === "save_debt") {
    if (draft.status === "saved") {
      // Idempotent: a second tap on an already-saved draft never inserts a second row.
      await answerSafely(cb.id, "Already saved.");
      return true;
    }

    const validation = validateDebtDraft(draft.fields);
    if (!validation.valid) {
      await answerSafely(cb.id, validation.errors.join(" "));
      return true;
    }

    const saved = saveDebt(validation.data);
    setDebtDraftStatus(draft.draftId, "saved");
    await tgEditMessageText(
      cb.message.chat.id,
      cb.message.message_id,
      `${cb.message.text ?? formatDebtPreview(draft.fields)}${formatSavedSuffix(saved.id)}`
    );
    await answerSafely(cb.id, "Debt saved successfully.");
    return true;
  }

  // action === "edit_debt"
  if (draft.status === "saved") {
    await answerSafely(cb.id, "This debt was already saved and can no longer be edited.");
    return true;
  }

  setDebtDraftStatus(draft.draftId, "awaiting_edit");
  await tgSendMessage(draft.chatId, formatEditableDraftText(draft.fields));
  await answerSafely(cb.id, "Edit the fields below and send them back as one message.");
  return true;
}

/**
 * Handles a plain-text reply while a chat has a draft awaiting edits.
 * Returns true if consumed, false if this chat has no such draft pending.
 */
export async function handleDebtDraftEditReply(message: TelegramMessage): Promise<boolean> {
  const text = message.text;
  if (!text) return false;

  const draft = findAwaitingEditDraftByChat(message.chat.id);
  if (!draft) return false;

  const updatedFields = parseEditedDraftText(text, draft.fields);
  const validation = validateDebtDraft(updatedFields);

  if (!validation.valid) {
    await tgSendMessage(
      message.chat.id,
      `Please correct and resend:\n- ${validation.errors.join("\n- ")}`
    );
    return true;
  }

  updateDebtDraftFields(draft.draftId, updatedFields);
  setDebtDraftStatus(draft.draftId, "pending_review");

  const sent = await tgSendMessage(
    message.chat.id,
    formatDebtPreview(updatedFields),
    buildDebtPreviewKeyboard(draft.draftId)
  );
  setDebtDraftLiveMessage(draft.draftId, sent.message_id);
  return true;
}

async function answerSafely(callbackQueryId: string, text: string): Promise<void> {
  try {
    await tgAnswerCallbackQuery(callbackQueryId, text);
  } catch (error) {
    console.error("Failed to answer callback query:", error);
  }
}
