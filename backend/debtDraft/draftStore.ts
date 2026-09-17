import { randomUUID } from "node:crypto";

export type DraftStatus = "pending" | "approved" | "rejected";

export interface DraftRecord {
  draftId: string;
  reviewerChatId: string | number;
  recipientChatId: string | number;
  recipientLabel: string;
  /** Current text shown to the reviewer: the AI draft, or the latest human edit. */
  text: string;
  /** Telegram message_id of whichever message currently carries the live Approve/Reject buttons. */
  liveMessageId: number;
  status: DraftStatus;
  /** Exact text the reviewer approved. Set once, never rewritten. */
  approvedText?: string;
  sentToRecipient: boolean;
  createdAt: number;
}

const drafts = new Map<string, DraftRecord>();

export function createDraft(
  input: Omit<
    DraftRecord,
    "draftId" | "status" | "sentToRecipient" | "createdAt"
  >
): DraftRecord {
  const draft: DraftRecord = {
    ...input,
    draftId: randomUUID(),
    status: "pending",
    sentToRecipient: false,
    createdAt: Date.now(),
  };
  drafts.set(draft.draftId, draft);
  return draft;
}

export function getDraft(draftId: string): DraftRecord | undefined {
  return drafts.get(draftId);
}

export function setLiveMessage(draftId: string, messageId: number): void {
  const draft = drafts.get(draftId);
  if (draft) draft.liveMessageId = messageId;
}

export function updateDraftText(draftId: string, text: string): void {
  const draft = drafts.get(draftId);
  if (draft) draft.text = text;
}

export function resolveDraft(
  draftId: string,
  status: "approved" | "rejected",
  options?: { approvedText?: string; sentToRecipient?: boolean }
): void {
  const draft = drafts.get(draftId);
  if (!draft) return;
  draft.status = status;
  if (options?.approvedText !== undefined) draft.approvedText = options.approvedText;
  if (options?.sentToRecipient !== undefined) draft.sentToRecipient = options.sentToRecipient;
}

/** Finds the pending draft whose live (button-carrying) message matches this id, in this chat. */
export function findPendingDraftByLiveMessage(
  chatId: string | number,
  messageId: number
): DraftRecord | undefined {
  for (const draft of drafts.values()) {
    if (
      draft.status === "pending" &&
      String(draft.reviewerChatId) === String(chatId) &&
      draft.liveMessageId === messageId
    ) {
      return draft;
    }
  }
  return undefined;
}
