import type { DebtDraftFields } from "./debtDraftStore.js";
import type { SaveDebtInput } from "./database/database.js";

export type DebtDraftValidationResult =
  | { valid: true; data: SaveDebtInput }
  | { valid: false; errors: string[] };

/** Applies to both the original collected draft and any user-edited version. */
export function validateDebtDraft(fields: DebtDraftFields): DebtDraftValidationResult {
  const errors: string[] = [];

  const name = fields.name?.trim();
  if (!name) errors.push("Name cannot be empty.");

  const amountText = fields.amount?.trim() ?? "";
  const numericAmount = Number.parseFloat(amountText.replace(/[^0-9.]/g, ""));
  if (!amountText || Number.isNaN(numericAmount)) {
    errors.push("Amount must be numeric.");
  }

  const reason = fields.reason?.trim();
  if (!reason) errors.push("Reason cannot be empty.");

  const overdue_period = fields.overdue_period?.trim();
  if (!overdue_period) errors.push("Overdue period cannot be empty.");

  const relationship = fields.relationship?.trim();
  if (!relationship) errors.push("Relationship cannot be empty.");

  const priorReminderText = fields.prior_reminder?.trim().toLowerCase();
  const prior_reminder =
    priorReminderText === "yes" || priorReminderText === "y"
      ? true
      : priorReminderText === "no" || priorReminderText === "n"
        ? false
        : undefined;
  if (prior_reminder === undefined) errors.push("Previous reminder must be Yes or No.");

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    data: {
      name: name!,
      amount: numericAmount,
      reason: reason!,
      overdue_period: overdue_period!,
      relationship: relationship!,
      prior_reminder: prior_reminder!,
      context: fields.context?.trim() || undefined,
      tone: fields.tone?.trim() || undefined,
    },
  };
}
