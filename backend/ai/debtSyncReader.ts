/**
 * Reads ONE candidate Gmail email against ONE specific target person, for the user-initiated
 * per-debt Gmail Sync feature (see backend/gmail/debtSync.ts, backend/api/routes/debts.ts's
 * POST /:debtId/sync). The model only extracts facts (incoming payment? exact amount? payer? is the
 * payer this person?) — the actual three-signal match (person + date + exact amount) is decided in
 * code by debtSync.ts, never by the model. Distinct from backend/ai/gmailPaymentReader.ts's
 * classifyPaymentEmail, which serves the *background* scanner. Mirrors that file's shape: call
 * Groq, parse via extractJson, and fall back to an honest "couldn't read this" result
 * (extractionFailed: true) rather than throwing, so one malformed candidate email never aborts the
 * whole sync.
 */

import { callGroqText } from "./groqClient.js";
import {
  AiRequestError,
  buildDebtSyncPrompt,
  DEBT_SYNC_SYSTEM_PROMPT,
  emptyDebtSyncExtraction,
  extractJson,
  mapRawDebtSyncExtraction,
  type DebtSyncExtraction,
  type RawDebtSyncExtraction,
} from "./types.js";

const CLASSIFICATION_MAX_TOKENS = 220;

export async function extractDebtSyncCandidate(params: {
  personName: string;
  personUsername: string | null;
  personPhone: string | null;
  emailSubject: string;
  emailBody: string;
}): Promise<DebtSyncExtraction> {
  try {
    const raw = await callGroqText({
      system: DEBT_SYNC_SYSTEM_PROMPT,
      prompt: buildDebtSyncPrompt(params),
      maxTokens: CLASSIFICATION_MAX_TOKENS,
      reasoningEffort: "low",
    });
    const parsed = extractJson<Partial<RawDebtSyncExtraction>>(raw);
    return mapRawDebtSyncExtraction(parsed);
  } catch (error) {
    if (error instanceof AiRequestError) {
      // Groq's own inability to produce a schema-valid completion for this one email — a real,
      // valid "skip this candidate" result, not a crash of the whole sync.
      return emptyDebtSyncExtraction();
    }
    throw error;
  }
}
