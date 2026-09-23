/**
 * Classifies one Gmail message (subject + plain-text body) as a payment-received notification or
 * not, for the background payment scanner (backend/gmail/paymentScanner.ts). Mirrors
 * skills/expenseReaderSkill.ts's shape: a flat, minimal raw schema, `reasoningEffort: "low"` to
 * bound the text model's hidden reasoning budget, and a real "couldn't parse this" result
 * (`extractionFailed: true`) rather than throwing, so one malformed email never crashes a whole
 * scan tick.
 */

import { callGroqText } from "./groqClient.js";
import {
  AiRequestError,
  buildGmailPaymentPrompt,
  emptyGmailPaymentExtraction,
  extractJson,
  GMAIL_PAYMENT_SYSTEM_PROMPT,
  mapRawGmailPaymentExtraction,
  type GmailPaymentExtraction,
  type RawGmailPaymentExtraction,
} from "./types.js";

const CLASSIFICATION_MAX_TOKENS = 256;

export async function classifyPaymentEmail(subject: string, bodyText: string): Promise<GmailPaymentExtraction> {
  try {
    const raw = await callGroqText({
      system: GMAIL_PAYMENT_SYSTEM_PROMPT,
      prompt: buildGmailPaymentPrompt(subject, bodyText),
      maxTokens: CLASSIFICATION_MAX_TOKENS,
      reasoningEffort: "low",
    });
    const parsed = extractJson<Partial<RawGmailPaymentExtraction>>(raw);
    return mapRawGmailPaymentExtraction(parsed);
  } catch (error) {
    if (error instanceof AiRequestError) {
      // Groq's own inability to produce a schema-valid completion for this one email — a real,
      // valid "couldn't classify this" result, not a crash.
      return emptyGmailPaymentExtraction();
    }
    throw error;
  }
}
