/**
 * Message Draft Skill — turns a context object into a reminder message via
 * Groq. Creates drafts only. It never sends Telegram and never decides that
 * a message should be sent; that's telegramSkill's job, triggered only by
 * an explicit user action.
 *
 * `GROQ_TEXT_MODEL` (default openai/gpt-oss-120b) is a *reasoning* model — it
 * spends a hidden, otherwise-unbounded chain-of-thought budget out of
 * max_tokens before emitting any actual JSON. Left unchecked (as this call
 * originally was), a richer prompt — regenerating, or a person with real
 * history/other debts/selected items — can push that hidden reasoning past
 * the token budget before any JSON comes out, which Groq reports back as
 * "Failed to generate JSON... see 'failed_generation' for more details: max
 * completion tokens reached before generating a valid document". Reproduced
 * directly against the real API (3/3 failures on a regenerate-with-history
 * prompt), and fixed the same way skills/expenseReaderSkill.ts already fixes
 * the identical failure mode for image extraction: `reasoningEffort: "low"`
 * bounds the hidden budget, and a higher `maxTokens` gives headroom on top
 * of it. Re-verified 3/3 successes on the exact same prompt after this fix.
 */

import { callGroqText } from "../backend/ai/groqClient.js";
import {
  AiRequestError,
  REMINDER_SYSTEM_PROMPT,
  TONES,
  buildReminderPrompt,
  extractJson,
  normalizeGeneratedReminder,
  type GeneratedReminder,
  type ReminderContext,
  type Tone,
} from "../backend/ai/types.js";

const GENERATION_MAX_TOKENS = 1024;
const MAX_ATTEMPTS = 3;

function isValidReminder(value: GeneratedReminder): boolean {
  return (
    typeof value.message === "string" &&
    value.message.trim().length > 0 &&
    (TONES as readonly string[]).includes(value.tone)
  );
}

/** Groq's own inability to produce a schema-valid completion — as opposed to auth/network errors, which should fail immediately rather than burn retries. */
function isJsonGenerationFailure(error: unknown): boolean {
  return error instanceof AiRequestError && /json/i.test(error.message);
}

export async function draftReminderMessage(params: {
  context: ReminderContext;
  forcedTone?: Tone;
  previousMessage?: string;
}): Promise<GeneratedReminder> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callGroqText({
        system: REMINDER_SYSTEM_PROMPT,
        prompt: buildReminderPrompt(params),
        maxTokens: GENERATION_MAX_TOKENS,
        reasoningEffort: "low",
      });
      const parsed = normalizeGeneratedReminder(extractJson(raw), params.forcedTone);
      if (isValidReminder(parsed)) return parsed;
      lastError = new AiRequestError("AI response was missing a valid message/tone.");
    } catch (error) {
      lastError = error;
      if (!isJsonGenerationFailure(error)) throw error; // auth/network errors: fail fast, don't retry
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AiRequestError("Couldn't generate the message. Please try again.");
}
