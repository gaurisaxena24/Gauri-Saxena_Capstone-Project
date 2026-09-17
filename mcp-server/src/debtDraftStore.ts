/**
 * In-memory state for a debt draft between "form complete" and "saved to
 * SQLite" — the preview/edit/approval stage. Mirrors the Map-per-record
 * pattern used by ./draftStore.ts for the separate reminder-approval flow.
 */

import { randomUUID } from "node:crypto";

export type DebtDraftStatus = "pending_review" | "awaiting_edit" | "saved";

export interface DebtDraftFields {
  name: string;
  /** Kept as raw text until validation; parsed to a number only at save time. */
  amount: string;
  reason: string;
  overdue_period: string;
  relationship: string;
  /** Raw "Yes"/"No" text until validation. */
  prior_reminder: string;
  context?: string;
  tone?: string;
}

export interface DebtDraftRecord {
  draftId: string;
  chatId: string | number;
  fields: DebtDraftFields;
  status: DebtDraftStatus;
  /** Telegram message_id of whichever message currently carries the Save/Make Changes buttons. */
  liveMessageId?: number;
  createdAt: number;
}

const drafts = new Map<string, DebtDraftRecord>();

export function createDebtDraft(
  chatId: string | number,
  fields: DebtDraftFields
): DebtDraftRecord {
  const draft: DebtDraftRecord = {
    draftId: randomUUID(),
    chatId,
    fields,
    status: "pending_review",
    createdAt: Date.now(),
  };
  drafts.set(draft.draftId, draft);
  return draft;
}

export function getDebtDraft(draftId: string): DebtDraftRecord | undefined {
  return drafts.get(draftId);
}

export function setDebtDraftLiveMessage(draftId: string, messageId: number): void {
  const draft = drafts.get(draftId);
  if (draft) draft.liveMessageId = messageId;
}

export function setDebtDraftStatus(draftId: string, status: DebtDraftStatus): void {
  const draft = drafts.get(draftId);
  if (draft) draft.status = status;
}

export function updateDebtDraftFields(draftId: string, fields: DebtDraftFields): void {
  const draft = drafts.get(draftId);
  if (draft) draft.fields = fields;
}

/** Finds the draft this chat is currently mid-edit on, if any. */
export function findAwaitingEditDraftByChat(
  chatId: string | number
): DebtDraftRecord | undefined {
  for (const draft of drafts.values()) {
    if (draft.status === "awaiting_edit" && String(draft.chatId) === String(chatId)) {
      return draft;
    }
  }
  return undefined;
}
