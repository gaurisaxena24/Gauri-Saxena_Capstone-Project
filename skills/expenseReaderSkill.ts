/**
 * Expense Reader Skill.
 *
 * Turns an uploaded photo (a restaurant bill, a Google Pay/UPI screenshot, a
 * Splitwise screenshot, a receipt, a payment confirmation — anything) into
 * structured expense data. It does NOT create debts, touch people, or send
 * Telegram — it only reads.
 *
 * Groq Vision is tried first, but only if GROQ_VISION_MODEL is actually set
 * (standard Groq accounts have no vision-capable model — verified directly
 * against the real API rather than assumed). If vision isn't configured, or
 * a configured vision call fails, this automatically falls back to local OCR
 * (tesseract.js) followed by a Groq text call over the extracted text. The
 * caller never has to choose between the two paths.
 *
 * `GROQ_TEXT_MODEL` (default openai/gpt-oss-120b) is a *reasoning* model — it
 * spends a hidden, otherwise-unbounded chain-of-thought budget out of
 * max_tokens before emitting any actual JSON. Left unchecked, on a noisier
 * real-world screenshot that reasoning alone can exceed max_tokens, cutting
 * the response off before any JSON is produced — which is exactly what Groq
 * reports back as "Failed to generate/validate JSON... see 'failed_generation'
 * for more details" (reproduced directly against the real API while
 * debugging this). `reasoningEffort: "low"` bounds that hidden budget, a
 * higher maxTokens gives headroom on top of it, and the flat, minimal
 * RawExpenseExtraction schema gives the model less structure to get wrong —
 * three independent mitigations for the same failure mode.
 */

import Tesseract from "tesseract.js";
import { callGroqText, callGroqVision, getVisionModel } from "../backend/ai/groqClient.js";
import {
  EXPENSE_SYSTEM_PROMPT,
  EXPENSE_USER_PROMPT,
  emptyExpenseExtraction,
  extractJson,
  mapRawExtractionToExpense,
  AiRequestError,
  type ExpenseExtraction,
  type RawExpenseExtraction,
} from "../backend/ai/types.js";

export type ExtractionMethod = "vision" | "ocr";

export interface ExpenseReadResult {
  extraction: ExpenseExtraction;
  method: ExtractionMethod;
  /** True if the model genuinely couldn't read the image — a valid, empty result, not a crash. */
  extractionFailed?: boolean;
}

// Itemized bills produce much bigger JSON than a flat total — the old 2048 budget was tuned for
// the pre-line-items schema and could truncate a many-item receipt before it finished.
const EXTRACTION_MAX_TOKENS = 3072;

const DEBUG = process.env.NODE_ENV !== "production";
function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log("[expense-extract]", ...args);
}

/** Groq's own inability to produce a schema-valid completion — as opposed to auth/network errors. */
function isJsonGenerationFailure(error: unknown): boolean {
  return error instanceof AiRequestError && /json/i.test(error.message);
}

async function runExtraction(call: () => Promise<string>): Promise<ExpenseExtraction> {
  const raw = await call();
  debugLog("raw model response (first 500 chars):", raw.slice(0, 500));
  let parsed: Partial<RawExpenseExtraction>;
  try {
    parsed = extractJson<Partial<RawExpenseExtraction>>(raw);
  } catch (error) {
    debugLog("JSON extraction/parsing failed:", error instanceof Error ? error.message : error);
    throw error;
  }
  const mapped = mapRawExtractionToExpense(parsed);
  debugLog(
    `mapped: ${mapped.lineItems.length} item(s), grandTotal=${mapped.total}, confidence=${mapped.confidence}`
  );
  return mapped;
}

async function readViaOcr(imageBuffer: Buffer): Promise<{ extraction: ExpenseExtraction; extractionFailed: boolean }> {
  const {
    data: { text },
  } = await Tesseract.recognize(imageBuffer, "eng");
  debugLog(`OCR read ${text?.length ?? 0} character(s) of text`);

  if (!text || !text.trim()) {
    // No text at all to work with — a real, valid "couldn't read this" result, not an error to throw.
    debugLog("OCR returned no usable text");
    return { extraction: emptyExpenseExtraction(), extractionFailed: true };
  }

  try {
    const extraction = await runExtraction(() =>
      callGroqText({
        system: EXPENSE_SYSTEM_PROMPT,
        prompt: `${EXPENSE_USER_PROMPT}\n\nThis was read via OCR from a photo, so expect some noise/misreads. Raw text:\n"""\n${text.trim()}\n"""`,
        maxTokens: EXTRACTION_MAX_TOKENS,
        reasoningEffort: "low",
      })
    );
    return { extraction, extractionFailed: false };
  } catch (error) {
    if (isJsonGenerationFailure(error)) {
      return { extraction: emptyExpenseExtraction(), extractionFailed: true };
    }
    throw error;
  }
}

export async function readExpenseFromImage(imageBuffer: Buffer, mediaType: string): Promise<ExpenseReadResult> {
  const visionModel = getVisionModel();
  debugLog(
    `image received: ${imageBuffer.length} bytes, mediaType=${mediaType}, visionModel=${visionModel ?? "(not set — will use OCR fallback)"}`
  );

  if (visionModel) {
    try {
      const extraction = await runExtraction(() =>
        callGroqVision({
          model: visionModel,
          system: EXPENSE_SYSTEM_PROMPT,
          prompt: EXPENSE_USER_PROMPT,
          imageBase64: imageBuffer.toString("base64"),
          mediaType,
          maxTokens: EXTRACTION_MAX_TOKENS,
          reasoningEffort: "low",
        })
      );
      debugLog("vision extraction succeeded");
      return { extraction, method: "vision" };
    } catch (error) {
      if (isJsonGenerationFailure(error)) {
        debugLog("vision call returned malformed/no JSON — treating as an honest 'couldn't read this'");
        return { extraction: emptyExpenseExtraction(), method: "vision", extractionFailed: true };
      }
      console.error(
        `[expense-extract] Groq vision attempt failed (model=${visionModel}), falling back to OCR:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const { extraction, extractionFailed } = await readViaOcr(imageBuffer);
  return { extraction, method: "ocr", extractionFailed };
}
