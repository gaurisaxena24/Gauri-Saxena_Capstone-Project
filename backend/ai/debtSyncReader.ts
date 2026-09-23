/**
 * Classifies ONE candidate Gmail email against ONE specific target debt (a named person, an exact
 * amount, a date), for the user-initiated per-debt Gmail Sync feature (see
 * backend/gmail/debtSync.ts, backend/api/routes/debts.ts's POST /:debtId/sync). Distinct from
 * backend/ai/gmailPaymentReader.ts's classifyPaymentEmail, which does open "is this a payment email
 * at all" extraction for the *background* scanner across every unpaid debt — this is a targeted,
 * single-debt check. Mirrors that file's shape: call Groq, parse via extractJson, and fall back to
 * an honest "couldn't classify this" result (extractionFailed: true) rather than throwing, so one
 * malformed candidate email never aborts the whole sync.
 */

import { callGroqText } from "./groqClient.js";
import {
  AiRequestError,
  buildDebtSyncPrompt,
  DEBT_SYNC_SYSTEM_PROMPT,
  emptyDebtSyncClassification,
  extractJson,
  mapRawDebtSyncClassification,
  type DebtSyncClassification,
  type RawDebtSyncClassification,
} from "./types.js";

const CLASSIFICATION_MAX_TOKENS = 220;

export async function classifyDebtSyncCandidate(params: {
  personName: string;
  personUsername: string | null;
  personPhone: string | null;
  amount: number;
  currency: string | null;
  expenseDate: string | null;
  emailSubject: string;
  emailBody: string;
}): Promise<DebtSyncClassification> {
  try {
    const raw = await callGroqText({
      system: DEBT_SYNC_SYSTEM_PROMPT,
      prompt: buildDebtSyncPrompt(params),
      maxTokens: CLASSIFICATION_MAX_TOKENS,
      reasoningEffort: "low",
    });
    const parsed = extractJson<Partial<RawDebtSyncClassification>>(raw);
    return mapRawDebtSyncClassification(parsed);
  } catch (error) {
    if (error instanceof AiRequestError) {
      // Groq's own inability to produce a schema-valid completion for this one email — a real,
      // valid "skip this candidate" result, not a crash of the whole sync.
      return emptyDebtSyncClassification();
    }
    throw error;
  }
}
