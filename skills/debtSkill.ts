/**
 * Debt Skill — persistence for expenses and the per-person debts they
 * create. One expense can have more than one expense_debts row (one per
 * person attached to it); today's UI only ever attaches one, but nothing
 * here assumes that.
 */

import {
  createExpense,
  createExpenseDebt,
  deleteExpense,
  deleteExpenseDebt,
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
  subtotal?: number | null;
  tax: number | null;
  tip: number | null;
  serviceCharge?: number | null;
  discount?: number | null;
  category: string | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  description: string | null;
  lineItems: ExpenseLineItem[];
  visibleNames: string[];
  imagePath: string | null;
  rawExtraction: unknown;
  confidence?: number | null;
}

export function recordExpense(userId: number, input: NewExpenseInput): Promise<Expense> {
  return createExpense(userId, input);
}

export function getExpenseById(userId: number, id: number): Promise<Expense | undefined> {
  return getExpense(userId, id);
}

export function listAllExpenses(userId: number, limit?: number): Promise<Expense[]> {
  return listExpenses(userId, limit);
}

/** Removes an expense and only that expense — never `people`, never the debts drafted against it. */
export function removeExpense(userId: number, id: number): Promise<{ imagePath: string | null } | undefined> {
  return deleteExpense(userId, id);
}

export function editExpense(
  userId: number,
  id: number,
  patch: Partial<{
    merchant: string | null;
    expenseDate: string | null;
    total: number;
    currency: string | null;
    subtotal: number | null;
    tax: number | null;
    tip: number | null;
    serviceCharge: number | null;
    discount: number | null;
    category: string | null;
    paymentMethod: string | null;
    description: string | null;
    lineItems: ExpenseLineItem[];
  }>
): Promise<Expense | undefined> {
  return updateExpense(userId, id, patch);
}

export function attachDebt(
  userId: number,
  input: {
    expenseId: number;
    personId: number;
    amount: number;
    currency: string | null;
    shareMode: ShareModeValue;
    additionalContext: string | null;
    desiredAction: string | null;
    contextJson: unknown;
    selectedItems?: Array<{ name: string; amount: number }> | null;
  }
): Promise<ExpenseDebt> {
  return createExpenseDebt(userId, input);
}

export function getDebt(userId: number, id: number): Promise<ExpenseDebt | undefined> {
  return getExpenseDebt(userId, id);
}

export function getDebtsByExpense(userId: number, expenseId: number): Promise<ExpenseDebt[]> {
  return getDebtsForExpense(userId, expenseId);
}

export function getDebtsByPerson(userId: number, personId: number): Promise<ExpenseDebt[]> {
  return getDebtsForPerson(userId, personId);
}

export function listAllDebts(userId: number, limit?: number): Promise<ExpenseDebt[]> {
  return listRecentDebts(userId, limit);
}

export function saveContext(userId: number, debtId: number, context: unknown): Promise<ExpenseDebt | undefined> {
  return updateDebtContext(userId, debtId, context);
}

export function saveDraftMessage(
  userId: number,
  debtId: number,
  patch: { message: string; tone: string | null; edited: boolean }
): Promise<ExpenseDebt | undefined> {
  return updateDebtDraftMessage(userId, debtId, patch);
}

export function markPaid(userId: number, debtId: number, status: DebtStatus = "PAID"): Promise<ExpenseDebt | undefined> {
  return setDebtStatus(userId, debtId, status);
}

/** Removes a debt ("send request") and its own send-history only — never the person or expense it references. */
export function removeDebt(userId: number, debtId: number): Promise<boolean> {
  return deleteExpenseDebt(userId, debtId);
}
