/**
 * Expense Reader Agent — the addressable interface debtCollectorAgent (Main
 * Agent) calls to turn an uploaded image into structured expense data.
 * Delegates to skills/expenseReaderSkill.ts, which handles the Groq
 * Vision-then-OCR-fallback logic.
 */

import { readExpenseFromImage, type ExpenseReadResult, type ExtractionMethod } from "../skills/expenseReaderSkill.js";

export type { ExpenseReadResult, ExtractionMethod };

export function readImage(imageBuffer: Buffer, mediaType: string): Promise<ExpenseReadResult> {
  return readExpenseFromImage(imageBuffer, mediaType);
}
