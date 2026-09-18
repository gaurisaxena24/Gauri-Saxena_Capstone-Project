import { z } from "zod";
import { generateDraftText } from "../debtDraft/draftText.js";
import { createDraft, setLiveMessage } from "../debtDraft/draftStore.js";
import { tgSendMessage } from "../telegram/rawApi.js";
import { buildApprovalKeyboard, formatReviewMessage } from "../review/reviewMessage.js";

export const createDebtReminderDraftInputSchema = z.object({
  person_name: z.string().min(1).describe("Name of the person who owes money"),
  amount: z.string().min(1).describe("Amount owed, e.g. '₹500'"),
  reason: z.string().min(1).describe("What the debt is for, e.g. 'dinner'"),
  days_overdue: z.number().int().min(0).describe("Days since the debt became due"),
  relationship: z
    .string()
    .optional()
    .describe("Relationship to the debtor, e.g. 'friend', 'roommate'"),
  prior_reminder: z
    .boolean()
    .optional()
    .describe("Whether a reminder has already been sent before"),
  tone: z
    .string()
    .optional()
    .describe("Desired tone, e.g. 'polite', 'sarcastic', 'stern', 'funny', 'unhinged'"),
  additional_context: z
    .string()
    .optional()
    .describe("Any extra context to fold into the draft"),
  recipient_chat_id: z
    .union([z.string(), z.number()])
    .optional()
    .describe(
      "Telegram chat ID of the final recipient. If omitted, the approved message is sent " +
        "back to the reviewer's own chat in TEST MODE instead of a real recipient."
    ),
});

export type CreateDebtReminderDraftInput = z.infer<
  typeof createDebtReminderDraftInputSchema
>;

export interface CreateDebtReminderDraftResult {
  success: boolean;
  message: string;
  draftId?: string;
  draftText?: string;
}

export async function createDebtReminderDraft(
  input: CreateDebtReminderDraftInput
): Promise<CreateDebtReminderDraftResult> {
  const parsed = createDebtReminderDraftInputSchema.parse(input);
  const reviewerChatId = process.env.TELEGRAM_REVIEWER_CHAT_ID;

  if (!reviewerChatId) {
    return {
      success: false,
      message:
        "TELEGRAM_REVIEWER_CHAT_ID is not configured. Set it in your .env file.",
    };
  }

  const draftText = generateDraftText({
    personName: parsed.person_name,
    amount: parsed.amount,
    reason: parsed.reason,
    daysOverdue: parsed.days_overdue,
    relationship: parsed.relationship,
    priorReminder: parsed.prior_reminder,
    tone: parsed.tone,
    additionalContext: parsed.additional_context,
  });

  const usingTestMode = parsed.recipient_chat_id === undefined;
  const recipientChatId = parsed.recipient_chat_id ?? reviewerChatId;
  const recipientLabel = usingTestMode
    ? `${parsed.person_name} [TEST MODE: no recipient_chat_id given, approved message will be sent back to your own chat]`
    : parsed.person_name;

  const draft = createDraft({
    reviewerChatId,
    recipientChatId,
    recipientLabel,
    text: draftText,
    liveMessageId: 0,
  });

  try {
    const sent = await tgSendMessage(
      reviewerChatId,
      formatReviewMessage({
        draftId: draft.draftId,
        recipientLabel,
        draftText,
        edited: false,
      }),
      buildApprovalKeyboard(draft.draftId)
    );
    setLiveMessage(draft.draftId, sent.message_id);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { success: false, message: text, draftId: draft.draftId, draftText };
  }

  return {
    success: true,
    message:
      "Draft sent to Telegram for review. Nothing will be sent to the recipient until you tap Approve.",
    draftId: draft.draftId,
    draftText,
  };
}
