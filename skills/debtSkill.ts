/**
 * Debt Skill — persistence for expenses and the per-person debts they
 * create. One expense can have more than one expense_debts row (one per
 * person attached to it); today's UI only ever attaches one, but nothing
 * here assumes that.
 */

import {
  createExpense,
  createExpenseDebt,
  getDebtsForExpense,
  getDebtsForPerson,
  getExpense,
  getExpenseDebt,
  listExpenses,
  listRecentDebts,
  setDebtStatus,
  updateDebtContext,
  updateDebtDraftMessage,
  updateExpense,
  type DebtStatus,
  type Expense,
  type ExpenseDebt,
  type ExpenseLineItem,
  type ExpenseSource,
  type ShareModeValue,
} from "../backend/database/database.js";

export interface NewExpenseInput {
  source: ExpenseSource;
  merchant: string | null;
  expenseDate: string | null;
  total: number;
  currency: string | null;
  tax: number | null;
  tip: number | null;
  category: string | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  description: string | null;
  lineItems: ExpenseLineItem[];
  visibleNames: string[];
  imagePath: string | null;
  rawExtraction: unknown;
}

export function recordExpense(input: NewExpenseInput): Expense {
  return createExpense(input);
}

export function getExpenseById(id: number): Expense | undefined {
  return getExpense(id);
}

export function listAllExpenses(limit?: number): Expense[] {
  return listExpenses(limit);
}

export function editExpense(
  id: number,
  patch: Partial<{
    merchant: string | null;
    expenseDate: string | null;
    total: number;
    currency: string | null;
    tax: number | null;
    tip: number | null;
    category: string | null;
    paymentMethod: string | null;
    description: string | null;
    lineItems: ExpenseLineItem[];
  }>
): Expense | undefined {
  return updateExpense(id, patch);
}

export function attachDebt(input: {
  expenseId: number;
  personId: number;
  amount: number;
  currency: string | null;
  shareMode: ShareModeValue;
  additionalContext: string | null;
  desiredAction: string | null;
  contextJson: unknown;
}): ExpenseDebt {
  return createExpenseDebt(input);
}

export function getDebt(id: number): ExpenseDebt | undefined {
  return getExpenseDebt(id);
}

export function getDebtsByExpense(expenseId: number): ExpenseDebt[] {
  return getDebtsForExpense(expenseId);
}

export function getDebtsByPerson(personId: number): ExpenseDebt[] {
  return getDebtsForPerson(personId);
}

export function listAllDebts(limit?: number): ExpenseDebt[] {
  return listRecentDebts(limit);
}

export function saveContext(debtId: number, context: unknown): ExpenseDebt | undefined {
  return updateDebtContext(debtId, context);
}

export function saveDraftMessage(
  debtId: number,
  patch: { message: string; tone: string | null; edited: boolean }
): ExpenseDebt | undefined {
  return updateDebtDraftMessage(debtId, patch);
}

export function markPaid(debtId: number, status: DebtStatus = "PAID"): ExpenseDebt | undefined {
  return setDebtStatus(debtId, status);
}
