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

import { callGroqText, parseGroqRetryDelayMs } from "../backend/ai/groqClient.js";
import {
  AiRequestError,
  REMINDER_SYSTEM_PROMPT,
  THANK_YOU_SYSTEM_PROMPT,
  TONES,
  buildReminderPrompt,
  buildThankYouPrompt,
  extractJson,
  normalizeGeneratedReminder,
  normalizeGeneratedThankYou,
  type GeneratedReminder,
  type PaidVia,
  type ReminderContext,
  type Tone,
} from "../backend/ai/types.js";

const GENERATION_MAX_TOKENS = 1024;
const MAX_ATTEMPTS = 3;
// Groq's free "on_demand" tier caps tokens-per-minute quite low (8000 at time of writing) —
// bursts of generate/regenerate calls close together routinely hit it. Rather than surfacing
// Groq's raw "Rate limit reached... Please try again in 11.99s" to the user, wait out the exact
// delay Groq itself reports and retry automatically, capped so a request never hangs too long.
const MAX_RATE_LIMIT_WAIT_MS = 20_000;

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

/** Groq's own wait from a rate-limit error ("Please try again in 11.99s" / "7m26.4s"), if it was one. */
function rateLimitWaitMs(error: unknown): number | null {
  if (!(error instanceof AiRequestError) || !/rate limit/i.test(error.message)) return null;
  return parseGroqRetryDelayMs(error.message) ?? 5_000;
}

/** Only a short, per-minute style limit is worth waiting out in-request; a long one (e.g. the daily
 * token limit, "try again in 7m26s") fails straight away instead of retrying into the same wall. */
function shouldRetryAfter(waitMs: number): boolean {
  return waitMs <= MAX_RATE_LIMIT_WAIT_MS;
}

function rateLimitedError(error: unknown): AiRequestError {
  const waitMs = rateLimitWaitMs(error) ?? 0;
  if (waitMs > MAX_RATE_LIMIT_WAIT_MS) {
    const minutes = Math.ceil(waitMs / 60_000);
    return new AiRequestError(`Groq's AI limit is used up for now — try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  return new AiRequestError("Groq's rate limit is briefly maxed out — please wait a few seconds and try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function draftReminderMessage(params: {
  context: ReminderContext;
  forcedTone?: Tone;
  previousMessage?: string;
  /** Set only for an automatic escalation follow-up — see skills/escalationSkill.ts. */
  escalationNote?: string;
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
      const rateLimitWait = rateLimitWaitMs(error);
      if (rateLimitWait !== null) {
        if (!shouldRetryAfter(rateLimitWait)) break;
        if (attempt < MAX_ATTEMPTS) await sleep(rateLimitWait + 250);
        continue;
      }
      if (!isJsonGenerationFailure(error)) throw error; // auth/network errors: fail fast, don't retry
    }
  }
  if (rateLimitWaitMs(lastError) !== null) throw rateLimitedError(lastError);
  throw lastError instanceof Error
    ? lastError
    : new AiRequestError("Couldn't generate the message. Please try again.");
}

/** The one-time "thanks for paying" message sent when a debt is marked paid — see backend/ai/types.ts's THANK_YOU_SYSTEM_PROMPT. */
export async function draftThankYouMessage(context: ReminderContext, paidVia: PaidVia): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callGroqText({
        system: THANK_YOU_SYSTEM_PROMPT,
        prompt: buildThankYouPrompt(context, paidVia),
        maxTokens: 256,
        reasoningEffort: "low",
      });
      return normalizeGeneratedThankYou(extractJson(raw));
    } catch (error) {
      lastError = error;
      const rateLimitWait = rateLimitWaitMs(error);
      if (rateLimitWait !== null) {
        if (!shouldRetryAfter(rateLimitWait)) break;
        if (attempt < MAX_ATTEMPTS) await sleep(rateLimitWait + 250);
        continue;
      }
      if (!isJsonGenerationFailure(error)) throw error;
    }
  }
  if (rateLimitWaitMs(lastError) !== null) throw rateLimitedError(lastError);
  throw lastError instanceof Error
    ? lastError
    : new AiRequestError("Couldn't generate the thank-you message. Please try again.");
}
