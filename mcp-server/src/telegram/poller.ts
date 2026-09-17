import {
  tgGetUpdates,
  tgSendMessage,
  tgEditMessageText,
  tgAnswerCallbackQuery,
  type TelegramUpdate,
  type TelegramMessage,
  type TelegramCallbackQuery,
} from "./rawApi.js";
import {
  getDraft,
  updateDraftText,
  setLiveMessage,
  resolveDraft,
  findPendingDraftByLiveMessage,
} from "../draftStore.js";
import {
  buildApprovalKeyboard,
  formatReviewMessage,
  formatResolvedSuffix,
} from "../reviewMessage.js";
import { sendTelegramMessage } from "../tools/sendTelegramMessage.js";
import { runDebtCollectorAgentStep } from "../agent/debtinfoAgent.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort: the button press already happened, so a failed toast must not undo it. */
async function safeAnswerCallbackQuery(id: string, text: string): Promise<void> {
  try {
    await tgAnswerCallbackQuery(id, text);
  } catch (error) {
    console.error("Failed to answer callback query:", error);
  }
}

async function handleReplyEdit(message: TelegramMessage): Promise<void> {
  const replyTo = message.reply_to_message;
  if (!replyTo || !message.text) return;

  const draft = findPendingDraftByLiveMessage(message.chat.id, replyTo.message_id);
  if (!draft) return;

  updateDraftText(draft.draftId, message.text);

  const newMessage = await tgSendMessage(
    draft.reviewerChatId,
    formatReviewMessage({
      draftId: draft.draftId,
      recipientLabel: draft.recipientLabel,
      draftText: message.text,
      edited: true,
    }),
    buildApprovalKeyboard(draft.draftId)
  );
  setLiveMessage(draft.draftId, newMessage.message_id);
}

async function handleCallbackQuery(cb: TelegramCallbackQuery): Promise<void> {
  if (!cb.data || !cb.message) return;
  const [action, draftId] = cb.data.split(":");
  const draft = getDraft(draftId);

  if (
    !draft ||
    draft.status !== "pending" ||
    draft.liveMessageId !== cb.message.message_id
  ) {
    await safeAnswerCallbackQuery(
      cb.id,
      "This draft was already handled or has been superseded by a newer edit."
    );
    return;
  }

  if (action === "approve") {
    const approvedText = draft.text;
    const result = await sendTelegramMessage({
      chatId: draft.recipientChatId,
      message: approvedText,
      confirm: true,
    });
    resolveDraft(draft.draftId, "approved", {
      approvedText,
      sentToRecipient: result.success,
    });
    await tgEditMessageText(
      cb.message.chat.id,
      cb.message.message_id,
      `${cb.message.text ?? approvedText}${formatResolvedSuffix("approved")}`
    );
    await safeAnswerCallbackQuery(
      cb.id,
      result.success ? "Approved and sent." : `Approved, but send failed: ${result.message}`
    );
    return;
  }

  if (action === "reject") {
    resolveDraft(draft.draftId, "rejected");
    await tgEditMessageText(
      cb.message.chat.id,
      cb.message.message_id,
      `${cb.message.text ?? draft.text}${formatResolvedSuffix("rejected")}`
    );
    await safeAnswerCallbackQuery(cb.id, "Rejected. Nothing was sent.");
  }
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message) {
    const consumedByDebtCollector = await runDebtCollectorAgentStep(update.message);
    if (!consumedByDebtCollector) {
      await handleReplyEdit(update.message);
    }
  } else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
  }
}

export async function startTelegramPoller(): Promise<void> {
  let offset = 0;

  try {
    const backlog = await tgGetUpdates(0, 0);
    if (backlog.length > 0) {
      offset = backlog[backlog.length - 1].update_id + 1;
    }
  } catch (error) {
    console.error("Failed to clear Telegram update backlog:", error);
  }

  for (;;) {
    try {
      const updates = await tgGetUpdates(offset, 25);
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error("Error handling Telegram update:", error);
        }
      }
    } catch (error) {
      console.error("Telegram getUpdates failed, retrying shortly:", error);
      await sleep(3000);
    }
  }
}
