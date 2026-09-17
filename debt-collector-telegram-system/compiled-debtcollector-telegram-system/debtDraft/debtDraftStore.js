/**
 * In-memory state for a debt draft between "form complete" and "saved to
 * SQLite" — the preview/edit/approval stage. Mirrors the Map-per-record
 * pattern used by ./draftStore.ts for the separate reminder-approval flow.
 */
import { randomUUID } from "node:crypto";
const drafts = new Map();
export function createDebtDraft(chatId, fields) {
    const draft = {
        draftId: randomUUID(),
        chatId,
        fields,
        status: "pending_review",
        createdAt: Date.now(),
    };
    drafts.set(draft.draftId, draft);
    return draft;
}
export function getDebtDraft(draftId) {
    return drafts.get(draftId);
}
export function setDebtDraftLiveMessage(draftId, messageId) {
    const draft = drafts.get(draftId);
    if (draft)
        draft.liveMessageId = messageId;
}
export function setDebtDraftStatus(draftId, status) {
    const draft = drafts.get(draftId);
    if (draft)
        draft.status = status;
}
export function updateDebtDraftFields(draftId, fields) {
    const draft = drafts.get(draftId);
    if (draft)
        draft.fields = fields;
}
/** Finds the draft this chat is currently mid-edit on, if any. */
export function findAwaitingEditDraftByChat(chatId) {
    for (const draft of drafts.values()) {
        if (draft.status === "awaiting_edit" && String(draft.chatId) === String(chatId)) {
            return draft;
        }
    }
    return undefined;
}
/** TEMPORARY DEBUG HELPER — remove once the multi-step loop is fully verified. */
export function debugListDebtDrafts() {
    return Array.from(drafts.values());
}
