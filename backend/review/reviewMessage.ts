import type { InlineKeyboardMarkup } from "../telegram/rawApi.js";

export function buildApprovalKeyboard(draftId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve & Send", callback_data: `approve:${draftId}` },
        { text: "❌ Reject", callback_data: `reject:${draftId}` },
      ],
    ],
  };
}

export function formatReviewMessage(params: {
  draftId: string;
  recipientLabel: string;
  draftText: string;
  edited: boolean;
}): string {
  const { draftId, recipientLabel, draftText, edited } = params;
  const shortId = draftId.slice(0, 8);
  const header = edited
    ? `✏️ EDITED DRAFT (#${shortId}) — awaiting your approval`
    : `💸 DEBT DRAFT (#${shortId}) — awaiting your approval`;

  return (
    `${header}\n\n` +
    `To: ${recipientLabel}\n\n` +
    `Draft:\n"${draftText}"\n\n` +
    `Reply to THIS message with new wording to edit it, or tap a button below.\n` +
    `Nothing is sent until you tap "Approve & Send".`
  );
}

export function formatResolvedSuffix(status: "approved" | "rejected"): string {
  return status === "approved"
    ? "\n\n✅ Approved — sent to the recipient."
    : "\n\n❌ Rejected — nothing was sent.";
}
