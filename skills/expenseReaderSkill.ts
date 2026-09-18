/**
 * Expense Reader Skill.
 *
 * Turns an uploaded photo (a restaurant bill, a Google Pay/UPI screenshot, a
 * receipt, a payment confirmation — anything) into structured expense data.
 * It does NOT create debts, touch people, or send Telegram — it only reads.
 *
 * Groq Vision is tried first, but only if GROQ_VISION_MODEL is actually set
 * (standard Groq accounts have no vision-capable model — verified directly
 * against the real API rather than assumed). If vision isn't configured, or
 * a configured vision call fails, this automatically falls back to local OCR
 * (tesseract.js) followed by a Groq text call over the extracted text. The
 * caller never has to choose between the two paths.
 */

import Tesseract from "tesseract.js";
import { callGroqText, callGroqVision, getVisionModel } from "../backend/ai/groqClient.js";
import {
  EXPENSE_SYSTEM_PROMPT,
  EXPENSE_USER_PROMPT,
  extractJson,
  normalizeExpenseExtraction,
  AiRequestError,
  type ExpenseExtraction,
} from "../backend/ai/types.js";

export type ExtractionMethod = "vision" | "ocr";

export interface ExpenseReadResult {
  extraction: ExpenseExtraction;
  method: ExtractionMethod;
}

async function readViaOcr(imageBuffer: Buffer): Promise<ExpenseExtraction> {
  const {
    data: { text },
  } = await Tesseract.recognize(imageBuffer, "eng");

  if (!text || !text.trim()) {
    throw new AiRequestError("Couldn't extract any readable text from this image. Try a clearer photo.");
  }

  const raw = await callGroqText({
    system: EXPENSE_SYSTEM_PROMPT,
    prompt: `${EXPENSE_USER_PROMPT}\n\nThis was read via OCR from a photo, so expect some noise/misreads. Raw text:\n"""\n${text.trim()}\n"""`,
    maxTokens: 1024,
  });
  return normalizeExpenseExtraction(extractJson<Partial<ExpenseExtraction>>(raw));
}

export async function readExpenseFromImage(imageBuffer: Buffer, mediaType: string): Promise<ExpenseReadResult> {
  const visionModel = getVisionModel();

  if (visionModel) {
    try {
      const raw = await callGroqVision({
        model: visionModel,
        system: EXPENSE_SYSTEM_PROMPT,
        prompt: EXPENSE_USER_PROMPT,
        imageBase64: imageBuffer.toString("base64"),
        mediaType,
        maxTokens: 1024,
      });
      return { extraction: normalizeExpenseExtraction(extractJson<Partial<ExpenseExtraction>>(raw)), method: "vision" };
    } catch (error) {
      console.error(
        "Groq vision attempt failed, falling back to OCR:",
        error instanceof Error ? error.message : error
      );
    }
  }

  const extraction = await readViaOcr(imageBuffer);
  return { extraction, method: "ocr" };
}
