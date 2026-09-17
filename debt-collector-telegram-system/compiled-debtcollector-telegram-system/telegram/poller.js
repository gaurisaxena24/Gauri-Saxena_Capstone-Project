import { tgGetUpdates, tgSendMessage, tgEditMessageText, tgAnswerCallbackQuery, } from "./rawApi.js";
import { getDraft, updateDraftText, setLiveMessage, resolveDraft, findPendingDraftByLiveMessage, } from "../draftStore.js";
import { buildApprovalKeyboard, formatReviewMessage, formatResolvedSuffix, } from "../reviewMessage.js";
import { sendTelegramMessage } from "../tools/sendTelegramMessage.js";
import { runDebtCollectorAgentStep } from "../agent/debtinfoAgent/debtinfoAgent.js";
import { handleDebtDraftCallback, handleDebtDraftEditReply, } from "../agent/debtDraftAgent/debtDraftAgent.js";
import { debugListSessions } from "../skills/debtFormStore/debtFormStore.js";
import { debugListDebtDrafts } from "../debtDraft/debtDraftStore.js";
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Best-effort: the button press already happened, so a failed toast must not undo it. */
async function safeAnswerCallbackQuery(id, text) {
    try {
        await tgAnswerCallbackQuery(id, text);
    }
    catch (error) {
        console.error("Failed to answer callback query:", error);
    }
}
async function handleReplyEdit(message) {
    const replyTo = message.reply_to_message;
    if (!replyTo || !message.text)
        return;
    const draft = findPendingDraftByLiveMessage(message.chat.id, replyTo.message_id);
    if (!draft)
        return;
    updateDraftText(draft.draftId, message.text);
    const newMessage = await tgSendMessage(draft.reviewerChatId, formatReviewMessage({
        draftId: draft.draftId,
        recipientLabel: draft.recipientLabel,
        draftText: message.text,
        edited: true,
    }), buildApprovalKeyboard(draft.draftId));
    setLiveMessage(draft.draftId, newMessage.message_id);
}
async function handleCallbackQuery(cb) {
    if (!cb.data || !cb.message)
        return;
    const [action, draftId] = cb.data.split(":");
    const draft = getDraft(draftId);
    if (!draft ||
        draft.status !== "pending" ||
        draft.liveMessageId !== cb.message.message_id) {
        await safeAnswerCallbackQuery(cb.id, "This draft was already handled or has been superseded by a newer edit.");
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
        await tgEditMessageText(cb.message.chat.id, cb.message.message_id, `${cb.message.text ?? approvedText}${formatResolvedSuffix("approved")}`);
        await safeAnswerCallbackQuery(cb.id, result.success ? "Approved and sent." : `Approved, but send failed: ${result.message}`);
        return;
    }
    if (action === "reject") {
        resolveDraft(draft.draftId, "rejected");
        await tgEditMessageText(cb.message.chat.id, cb.message.message_id, `${cb.message.text ?? draft.text}${formatResolvedSuffix("rejected")}`);
        await safeAnswerCallbackQuery(cb.id, "Rejected. Nothing was sent.");
    }
}
/** TEMPORARY DEBUG HELPER — remove once the multi-step loop is fully verified. */
async function handleDebugCommand(message) {
    if (message.text?.trim() !== "/debug")
        return false;
    const sessions = debugListSessions();
    const drafts = debugListDebtDrafts();
    const report = `[DEBUG] active debtFormStore sessions (${sessions.length}):\n${JSON.stringify(sessions, null, 2)}\n\n` +
        `[DEBUG] active debtDraftStore drafts (${drafts.length}):\n${JSON.stringify(drafts, null, 2)}`;
    console.log(report);
    await tgSendMessage(message.chat.id, report);
    return true;
}
export async function handleUpdate(update) {
    if (update.message) {
        if (await handleDebugCommand(update.message))
            return;
        const consumedByDebtCollector = await runDebtCollectorAgentStep(update.message);
        if (consumedByDebtCollector)
            return;
        const consumedByDraftEdit = await handleDebtDraftEditReply(update.message);
        if (consumedByDraftEdit)
            return;
        await handleReplyEdit(update.message);
    }
    else if (update.callback_query) {
        const consumedByDebtDraft = await handleDebtDraftCallback(update.callback_query);
        if (!consumedByDebtDraft) {
            await handleCallbackQuery(update.callback_query);
        }
    }
}
export async function startTelegramPoller() {
    let offset = 0;
    try {
        const backlog = await tgGetUpdates(0, 0);
        if (backlog.length > 0) {
            offset = backlog[backlog.length - 1].update_id + 1;
        }
    }
    catch (error) {
        console.error("Failed to clear Telegram update backlog:", error);
    }
    for (;;) {
        try {
            const updates = await tgGetUpdates(offset, 25);
            for (const update of updates) {
                offset = update.update_id + 1;
                try {
                    await handleUpdate(update);
                }
                catch (error) {
                    console.error("Error handling Telegram update:", error);
                }
            }
        }
        catch (error) {
            console.error("Telegram getUpdates failed, retrying shortly:", error);
            await sleep(3000);
        }
    }
}
