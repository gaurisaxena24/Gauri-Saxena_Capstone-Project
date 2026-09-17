import { randomUUID } from "node:crypto";
const drafts = new Map();
export function createDraft(input) {
    const draft = {
        ...input,
        draftId: randomUUID(),
        status: "pending",
        sentToRecipient: false,
        createdAt: Date.now(),
    };
    drafts.set(draft.draftId, draft);
    return draft;
}
export function getDraft(draftId) {
    return drafts.get(draftId);
}
export function setLiveMessage(draftId, messageId) {
    const draft = drafts.get(draftId);
    if (draft)
        draft.liveMessageId = messageId;
}
export function updateDraftText(draftId, text) {
    const draft = drafts.get(draftId);
    if (draft)
        draft.text = text;
}
export function resolveDraft(draftId, status, options) {
    const draft = drafts.get(draftId);
    if (!draft)
        return;
    draft.status = status;
    if (options?.approvedText !== undefined)
        draft.approvedText = options.approvedText;
    if (options?.sentToRecipient !== undefined)
        draft.sentToRecipient = options.sentToRecipient;
}
/** Finds the pending draft whose live (button-carrying) message matches this id, in this chat. */
export function findPendingDraftByLiveMessage(chatId, messageId) {
    for (const draft of drafts.values()) {
        if (draft.status === "pending" &&
            String(draft.reviewerChatId) === String(chatId) &&
            draft.liveMessageId === messageId) {
            return draft;
        }
    }
    return undefined;
}
