/**
 * Debt Collector Agent ("Main Agent") — coordinates the eight per-skill
 * agents into the operations the web app's API routes call. Each method is
 * one explicit step; nothing here chains straight through from generating a
 * message to sending it — that only ever happens across two separate HTTP
 * requests, the second one only ever triggered by the user's own
 * "Send on Telegram" click.
 *
 * This file never touches a skill directly — it only ever calls the
 * matching agent (profileAgent, expenseReaderAgent, debtCalculationAgent,
 * debtAgent, contextAgent, messageDraftAgent, telegramAgent, reminderAgent),
 * each of which owns exactly one skill.
 */

import * as expenseReaderAgent from "./expenseReaderAgent.js";
import * as profileAgent from "./profileAgent.js";
import * as debtAgent from "./debtAgent.js";
import * as debtCalculationAgent from "./debtCalculationAgent.js";
import * as contextAgent from "./contextAgent.js";
import * as messageDraftAgent from "./messageDraftAgent.js";
import * as telegramAgent from "./telegramAgent.js";
import * as reminderAgent from "./reminderAgent.js";
import type { ExpenseExtraction, ReminderContext, Tone } from "../backend/ai/types.js";
import type { Expense, ExpenseDebt, Person } from "../backend/database/database.js";
import type { ExpenseReadResult, ExtractionMethod } from "./expenseReaderAgent.js";
import type { ShareMode } from "./debtCalculationAgent.js";

export async function readImageExpense(imageBuffer: Buffer, mediaType: string): Promise<ExpenseReadResult> {
  return expenseReaderAgent.readImage(imageBuffer, mediaType);
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
  return debtAgent.recordExpense({
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
  return debtAgent.recordExpense({
    source: "IMAGE",
    merchant: extraction.merchant,
    expenseDate: extraction.date,
    total: extraction.total ?? 0,
    currency: extraction.currency,
    subtotal: extraction.subtotal,
    tax: extraction.tax,
    tip: extraction.tip,
    serviceCharge: extraction.serviceCharge,
    discount: extraction.discount,
    category: extraction.category,
    paymentMethod: extraction.paymentMethod,
    transactionReference: extraction.transactionReference,
    description: extraction.description,
    lineItems: extraction.lineItems,
    visibleNames: extraction.visibleNames,
    imagePath: params.imagePath,
    rawExtraction: { ...extraction, extractionMethod: params.method },
    confidence: extraction.confidence,
  });
}

export function attachPersonToExpense(params: {
  expenseId: number;
  personId: number;
  mode: ShareMode;
  customAmount?: number;
  additionalContext?: string | null;
  desiredAction?: string | null;
  selectedItems?: Array<{ name: string; amount: number }> | null;
}): { debt: ExpenseDebt; context: ReminderContext } {
  const expense = debtAgent.getExpenseById(params.expenseId);
  if (!expense) throw new Error("Expense not found.");
  const person = profileAgent.findPersonById(params.personId);
  if (!person) throw new Error("Person not found.");

  const amount = debtCalculationAgent.calculateShare(params.mode, expense.total, params.customAmount);
  const debt = debtAgent.attachDebt({
    expenseId: expense.id,
    personId: person.id,
    amount,
    currency: expense.currency,
    shareMode: params.mode,
    additionalContext: params.additionalContext?.trim() || null,
    desiredAction: params.desiredAction?.trim() || null,
    contextJson: null,
    selectedItems: params.selectedItems ?? null,
  });

  const context = contextAgent.buildContext({ person, expense, debt });
  // Persisted so regenerate/change-tone reuse the exact same facts rather
  // than drifting between calls.
  const withContext = debtAgent.saveContext(debt.id, context)!;
  return { debt: withContext, context };
}

export async function generateDraft(params: {
  debt: ExpenseDebt;
  context: ReminderContext;
  forcedTone?: Tone;
  regenerate?: boolean;
}) {
  const generated = await messageDraftAgent.draftMessage({
    context: params.context,
    forcedTone: params.forcedTone,
    previousMessage: params.regenerate ? (params.debt.message ?? undefined) : undefined,
  });
  const updated = debtAgent.saveDraftMessage(params.debt.id, {
    message: generated.message,
    tone: generated.tone,
    edited: false,
  });
  return { debt: updated!, reasoning: generated.reasoning };
}

export function editDraft(debtId: number, message: string) {
  const debt = debtAgent.getDebt(debtId);
  return debtAgent.saveDraftMessage(debtId, { message, tone: debt?.tone ?? null, edited: true });
}

export async function sendReminder(debt: ExpenseDebt, person: Person) {
  if (!debt.message) throw new Error("Generate a message before sending.");

  try {
    const result = await telegramAgent.sendMessage(person, debt.message);
    if (!result.success) {
      reminderAgent.logReminder({
        debtId: debt.id,
        personId: person.id,
        message: debt.message,
        tone: debt.tone,
        status: "FAILED",
      });
      return { success: false, error: result.message };
    }
    const reminder = reminderAgent.logReminder({
      debtId: debt.id,
      personId: person.id,
      message: debt.message,
      tone: debt.tone,
      status: "SENT",
      telegramMessageId: result.telegramMessageId,
    });
    return { success: true, reminder };
  } catch (error) {
    reminderAgent.logReminder({
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
  return debtAgent.markPaid(debtId, "PAID");
}

/** Removes a debt ("send request") only — the person and expense it references are always left untouched. */
export function removeDebt(debtId: number): boolean {
  return debtAgent.removeDebt(debtId);
}

/** Removes an expense only — never the person. Fails (a real DB foreign key) if any debt still references it; remove those debts first. */
export function removeExpense(expenseId: number): { imagePath: string | null } | undefined {
  return debtAgent.removeExpense(expenseId);
}

/** Removes a person only — never their expenses. Fails (a real DB foreign key) if any debt still references them; remove those debts first. */
export function removePerson(personId: number): boolean {
  return profileAgent.removePerson(personId);
}
