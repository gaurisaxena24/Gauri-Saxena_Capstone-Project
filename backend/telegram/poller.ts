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
} from "../debtDraft/draftStore.js";
import {
  buildApprovalKeyboard,
  formatReviewMessage,
  formatResolvedSuffix,
} from "../review/reviewMessage.js";
import { sendTelegramMessage } from "../tools/sendTelegramMessage.js";
import { getOwnerOfPerson, upsertTelegramContact, verifyPersonByCode, verifyPersonTelegram } from "../database/database.js";

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

/**
 * Handles the web app's Telegram-verification code (`/verify ABC123`, the
 * bare code on its own, or the code mentioned inside a longer message like
 * "hi its ABC123") — the only way to verify someone whose Telegram account
 * has no public @username, since the Bot API then gives no username to
 * match against at all, only a numeric id.
 *
 * Matching used to require the ENTIRE trimmed message to be exactly the
 * code, and stayed completely silent on anything else — so a real person
 * adding a word of context ("here's the code ABC123") got no reply and no
 * indication anything had gone wrong at all. Now it looks for a plausible
 * 6-8 character alphanumeric token anywhere in the message and always
 * replies once it finds one, whether it matches or not.
 */
async function handleVerifyCommand(message: TelegramMessage): Promise<boolean> {
  const text = message.text?.trim();
  if (!text) return false;

  const explicit = text.match(/\/?verify\W*([A-Za-z0-9]{4,8})/i);
  // A bare token (no "verify" prefix) is only treated as a code attempt if it contains at least
  // one digit — real codes almost always mix letters and digits, while a plain 6-letter English
  // word (e.g. "thanks") does not. Without this, ordinary chat gets misidentified as a failed
  // code attempt and receives an unwanted "doesn't match anyone" reply.
  const bareToken = [...text.matchAll(/\b([A-Za-z0-9]{6})\b/g)].find(([token]) => /[0-9]/.test(token));
  const match = explicit ?? bareToken;
  if (!match) return false;

  const code = match[1];
  const person = await verifyPersonByCode(code, message.chat.id, message.from?.id ?? message.chat.id);

  if (!person) {
    console.log(`[Telegram] code attempt "${code}" (from message "${text.slice(0, 80)}") didn't match anyone, chat ${message.chat.id}`);
    await tgSendMessage(
      message.chat.id,
      `"${code}" doesn't match anyone. Double-check the code shown in the app (it's case-insensitive, just the 6 characters) and send it again.`
    );
    return true;
  }

  console.log(`[Telegram] verified ${person.name} (person id ${person.id}) via code, chat ${message.chat.id}`);
  // Worded from the verifying person's own point of view: they are the one connecting, not the one
  // being reminded, so the confirmation says who they're now connected to — specifically the
  // app-user who owns *this* contact, not just whichever app-user registered first.
  const owner = await getOwnerOfPerson(person.id);
  const ownerLabel = owner ? `@${owner.telegram_username}` : "the app owner";
  await tgSendMessage(
    message.chat.id,
    `You're verified! You're now connected to ${ownerLabel}'s expense tracker and can receive reminders here.`
  );
  return true;
}

/**
 * The Bot API can only ever send a message to a numeric chat_id, never a
 * bare @username — so this is the only place a username-to-chat_id mapping
 * can come from: an incoming message that actually carries both. Recording
 * it here is what lets the web app's "Send via Telegram" resolve a person's
 * Telegram username to somewhere real to deliver to.
 */
async function recordTelegramContact(message: TelegramMessage): Promise<void> {
  const textPreview = message.text ? ` text: "${message.text.slice(0, 80)}"` : "";
  if (message.from?.username) {
    console.log(
      `[Telegram] incoming message from @${message.from.username} (user id ${message.from.id}, chat ${message.chat.id})${textPreview}`
    );
    await upsertTelegramContact(message.from.username, message.chat.id);
    // This incoming message is the only honest proof the Bot API gives us
    // that a claimed username belongs to a real, reachable Telegram account —
    // so it's also what marks a person's profile as Telegram-verified.
    await verifyPersonTelegram(message.from.username, message.chat.id, message.from.id);
  } else if (message.from) {
    // No public @username on this Telegram account — the Bot API gives no
    // other way to match it to a username a person typed into this app, so
    // username-matching verification can't happen for them, but the
    // code-based path (handleVerifyCommand) works regardless of this.
    console.log(
      `[Telegram] incoming message from user id ${message.from.id} (chat ${message.chat.id}) — no public @username.${textPreview}`
    );
  }
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message) {
    await recordTelegramContact(update.message);
    if (await handleVerifyCommand(update.message)) return;
    await handleReplyEdit(update.message);
  } else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
  }
}

export async function startTelegramPoller(): Promise<void> {
  let offset = 0;

  try {
    // Discarded rather than replayed through the full conversational flow —
    // stale messages shouldn't suddenly trigger the Skill/Agent loop after a
    // restart. But a backlog message is still real proof of who messaged the
    // bot, so it must still count for Telegram verification; otherwise every
    // dev-server restart (there can be many) silently erases any
    // verification attempt someone made while the server was down.
    const backlog = await tgGetUpdates(0, 0);
    for (const update of backlog) {
      if (update.message) {
        await recordTelegramContact(update.message);
        await handleVerifyCommand(update.message);
      }
    }
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
