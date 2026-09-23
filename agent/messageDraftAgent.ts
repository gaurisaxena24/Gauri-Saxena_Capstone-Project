/**
 * Message Draft Agent ("Message Agent") — the addressable interface
 * debtCollectorAgent (Main Agent) calls to turn a context object into a
 * reminder message via Groq. Delegates to skills/messageDraftSkill.ts.
 * Creates drafts only — never sends, never decides that a message should
 * be sent; that's telegramAgent's job, triggered only by an explicit user
 * action.
 */

import { draftReminderMessage, draftThankYouMessage } from "../skills/messageDraftSkill.js";
import type { GeneratedReminder, PaidVia, ReminderContext, Tone } from "../backend/ai/types.js";

export function draftMessage(params: {
  context: ReminderContext;
  forcedTone?: Tone;
  previousMessage?: string;
  escalationNote?: string;
}): Promise<GeneratedReminder> {
  return draftReminderMessage(params);
}

/** The one-time "thanks for paying" message — see skills/messageDraftSkill.ts. */
export function draftThankYou(context: ReminderContext, paidVia: PaidVia): Promise<string> {
  return draftThankYouMessage(context, paidVia);
}
