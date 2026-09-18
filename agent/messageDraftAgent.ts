/**
 * Message Draft Agent ("Message Agent") — the addressable interface
 * debtCollectorAgent (Main Agent) calls to turn a context object into a
 * reminder message via Groq. Delegates to skills/messageDraftSkill.ts.
 * Creates drafts only — never sends, never decides that a message should
 * be sent; that's telegramAgent's job, triggered only by an explicit user
 * action.
 */

import { draftReminderMessage } from "../skills/messageDraftSkill.js";
import type { GeneratedReminder, ReminderContext, Tone } from "../backend/ai/types.js";

export function draftMessage(params: {
  context: ReminderContext;
  forcedTone?: Tone;
  previousMessage?: string;
}): Promise<GeneratedReminder> {
  return draftReminderMessage(params);
}
