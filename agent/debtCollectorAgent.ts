/**
 * Debt Collector Agent — orchestrates the skills into the operations the web
 * app's API routes call. Each method is one explicit step; nothing here
 * chains straight through from generating a message to sending it — that
 * only ever happens across two separate HTTP requests, the second one only
 * ever triggered by the user's own "Send on Telegram" click.
 */

import { readExpenseFromImage, type ExtractionMethod } from "../skills/expenseReaderSkill.js";
import * as profileSkill from "../skills/profileSkill.js";
import * as debtSkill from "../skills/debtSkill.js";
import { computeShare, type ShareMode } from "../skills/debtCalculationSkill.js";
import { buildReminderContext } from "../skills/contextSkill.js";
import { draftReminderMessage } from "../skills/messageDraftSkill.js";
import { sendApprovedMessage } from "../skills/telegramSkill.js";
import * as reminderSkill from "../skills/reminderSkill.js";
import type { ExpenseExtraction, ReminderContext, Tone } from "../backend/ai/types.js";
import type { Expense, ExpenseDebt, Person } from "../backend/database/database.js";

export async function readImageExpense(
  imageBuffer: Buffer,
  mediaType: string
): Promise<{ extraction: ExpenseExtraction; method: ExtractionMethod }> {
  return readExpenseFromImage(imageBuffer, mediaType);
}

export function createManualExpense(input: {
  amount: number;
  currency: string | null;
  date: string | null;
  merchant: string | null;
  category: string | null;
  description: string | null;
  paymentMethod: string | null;
  notes: string | null;
}): Expense {
  return debtSkill.recordExpense({
    source: "MANUAL",
    merchant: input.merchant,
    expenseDate: input.date,
    total: input.amount,
    currency: input.currency,
    tax: null,
    tip: null,
    category: input.category,
    paymentMethod: input.paymentMethod,
    transactionReference: null,
    description: input.description ?? input.notes,
    lineItems: [],
    visibleNames: [],
    imagePath: null,
    rawExtraction: null,
  });
}

export function createImageExpense(params: {
  extraction: ExpenseExtraction;
  method: ExtractionMethod;
  imagePath: string;
}): Expense {
  const { extraction } = params;
  return debtSkill.recordExpense({
    source: "IMAGE",
    merchant: extraction.merchant,
    expenseDate: extraction.date,
    total: extraction.total ?? 0,
    currency: extraction.currency,
    tax: extraction.tax,
    tip: extraction.tip,
    category: extraction.category,
    paymentMethod: extraction.paymentMethod,
    transactionReference: extraction.transactionReference,
    description: extraction.description,
    lineItems: extraction.lineItems,
    visibleNames: extraction.visibleNames,
    imagePath: params.imagePath,
    rawExtraction: { ...extraction, extractionMethod: params.method },
  });
}

export function attachPersonToExpense(params: {
  expenseId: number;
  personId: number;
  mode: ShareMode;
  customAmount?: number;
}): { debt: ExpenseDebt; context: ReminderContext } {
  const expense = debtSkill.getExpenseById(params.expenseId);
  if (!expense) throw new Error("Expense not found.");
  const person = profileSkill.findPersonById(params.personId);
  if (!person) throw new Error("Person not found.");

  const amount = computeShare(params.mode, expense.total, params.customAmount);
  const debt = debtSkill.attachDebt({
    expenseId: expense.id,
    personId: person.id,
    amount,
    currency: expense.currency,
    contextJson: null,
  });

  const context = buildReminderContext({ person, expense, debt });
  // Persisted so regenerate/change-tone reuse the exact same facts rather
  // than drifting between calls.
  const withContext = debtSkill.saveContext(debt.id, context)!;
  return { debt: withContext, context };
}

export async function generateDraft(params: {
  debt: ExpenseDebt;
  context: ReminderContext;
  forcedTone?: Tone;
  regenerate?: boolean;
}) {
  const generated = await draftReminderMessage({
    context: params.context,
    forcedTone: params.forcedTone,
    previousMessage: params.regenerate ? (params.debt.message ?? undefined) : undefined,
  });
  const updated = debtSkill.saveDraftMessage(params.debt.id, {
    message: generated.message,
    tone: generated.tone,
    edited: false,
  });
  return { debt: updated!, reasoning: generated.reasoning };
}

export function editDraft(debtId: number, message: string) {
  const debt = debtSkill.getDebt(debtId);
  return debtSkill.saveDraftMessage(debtId, { message, tone: debt?.tone ?? null, edited: true });
}

export async function sendReminder(debt: ExpenseDebt, person: Person) {
  if (!debt.message) throw new Error("Generate a message before sending.");

  try {
    const result = await sendApprovedMessage(person, debt.message);
    if (!result.success) {
      reminderSkill.logReminder({
        debtId: debt.id,
        personId: person.id,
        message: debt.message,
        tone: debt.tone,
        status: "FAILED",
      });
      return { success: false, error: result.message };
    }
    const reminder = reminderSkill.logReminder({
      debtId: debt.id,
      personId: person.id,
      message: debt.message,
      tone: debt.tone,
      status: "SENT",
      telegramMessageId: result.telegramMessageId,
    });
    return { success: true, reminder };
  } catch (error) {
    reminderSkill.logReminder({
      debtId: debt.id,
      personId: person.id,
      message: debt.message,
      tone: debt.tone,
      status: "FAILED",
    });
    throw error;
  }
}

export function markDebtPaid(debtId: number) {
  return debtSkill.markPaid(debtId, "PAID");
}
