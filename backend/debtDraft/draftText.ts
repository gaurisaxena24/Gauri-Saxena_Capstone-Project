export interface DraftReminderInput {
  personName: string;
  amount: string;
  reason: string;
  daysOverdue: number;
  relationship?: string;
  priorReminder?: boolean;
  tone?: string;
  additionalContext?: string;
}

function overdueLine(daysOverdue: number): string {
  if (daysOverdue <= 0) return "which is due now";
  return `overdue by ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`;
}

/**
 * Deterministic, template-based draft generator. This is intentionally
 * simple (no external AI call) so the tool has no extra API dependency
 * for a capstone project — the calling agent can also pass richer
 * `additionalContext` to steer the wording, or a future version could
 * swap this for an LLM call without changing the surrounding workflow.
 */
export function generateDraftText(input: DraftReminderInput): string {
  const {
    personName,
    amount,
    reason,
    daysOverdue,
    priorReminder,
    tone,
    additionalContext,
  } = input;

  const overdue = overdueLine(daysOverdue);
  const followUp = priorReminder
    ? " This is a follow-up to a reminder you already sent."
    : "";
  const context = additionalContext ? ` ${additionalContext}` : "";

  const templates: Record<string, () => string> = {
    polite: () =>
      `Hi ${personName}, just a friendly reminder about the ${amount} for ${reason}, ${overdue}. Whenever you get a chance, I'd appreciate it if you could send it over.${followUp}${context}`,
    sarcastic: () =>
      `${personName}, I know you're busy building a personality that forgets debts, but that ${amount} for ${reason} is still ${overdue}. Whenever it's convenient for royalty.${followUp}${context}`,
    stern: () =>
      `${personName}, this is a direct reminder that you owe ${amount} for ${reason}, ${overdue}. Please settle this promptly.${followUp}${context}`,
    funny: () =>
      `${personName}, respectfully requesting the return of my ${amount} from ${reason} before I start invoicing you emotionally. It's been ${overdue}.${followUp}${context}`,
    unhinged: () =>
      `${personName}. The ${amount} for ${reason} has been ${overdue}. I have said nothing. I have seen everything.${followUp}${context}`,
  };

  const key = tone?.trim().toLowerCase();
  const template = key && templates[key] ? templates[key] : undefined;

  if (template) return template();

  const toneNote = tone ? ` (requested tone: ${tone})` : "";
  return `${personName}, this is a reminder that you owe ${amount} for ${reason}, ${overdue}.${followUp}${context}${toneNote}`;
}
