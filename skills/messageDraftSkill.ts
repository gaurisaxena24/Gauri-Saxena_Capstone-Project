/**
 * Message Draft Skill — turns a context object into a reminder message via
 * Groq. Creates drafts only. It never sends Telegram and never decides that
 * a message should be sent; that's telegramSkill's job, triggered only by
 * an explicit user action.
 */

import { callGroqText } from "../backend/ai/groqClient.js";
import {
  REMINDER_SYSTEM_PROMPT,
  buildReminderPrompt,
  extractJson,
  normalizeGeneratedReminder,
  type GeneratedReminder,
  type ReminderContext,
  type Tone,
} from "../backend/ai/types.js";

export async function draftReminderMessage(params: {
  context: ReminderContext;
  forcedTone?: Tone;
  previousMessage?: string;
}): Promise<GeneratedReminder> {
  const raw = await callGroqText({
    system: REMINDER_SYSTEM_PROMPT,
    prompt: buildReminderPrompt(params),
    maxTokens: 512,
  });
  return normalizeGeneratedReminder(extractJson(raw), params.forcedTone);
}
