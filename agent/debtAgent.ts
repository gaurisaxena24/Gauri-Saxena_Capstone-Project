/**
 * Debt Agent — the addressable interface debtCollectorAgent (Main Agent)
 * calls for everything about expenses and the per-person debts they create.
 * Delegates to skills/debtSkill.ts for the actual persistence.
 */

import * as debtSkill from "../skills/debtSkill.js";
import type { NewExpenseInput } from "../skills/debtSkill.js";
import type { DebtStatus, Expense, ExpenseDebt, ExpenseLineItem, ShareModeValue } from "../backend/database/database.js";

export type { NewExpenseInput };

export function recordExpense(userId: number, input: NewExpenseInput): Promise<Expense> {
  return debtSkill.recordExpense(userId, input);
}

export function getExpenseById(userId: number, id: number): Promise<Expense | undefined> {
  return debtSkill.getExpenseById(userId, id);
}

export function listAllExpenses(userId: number, limit?: number): Promise<Expense[]> {
  return debtSkill.listAllExpenses(userId, limit);
}

export function removeExpense(userId: number, id: number): Promise<{ imagePath: string | null } | undefined> {
  return debtSkill.removeExpense(userId, id);
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
  return debtSkill.editExpense(userId, id, patch);
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
  return debtSkill.attachDebt(userId, input);
}

export function getDebt(userId: number, id: number): Promise<ExpenseDebt | undefined> {
  return debtSkill.getDebt(userId, id);
}

export function getDebtsByExpense(userId: number, expenseId: number): Promise<ExpenseDebt[]> {
  return debtSkill.getDebtsByExpense(userId, expenseId);
}

export function getDebtsByPerson(userId: number, personId: number): Promise<ExpenseDebt[]> {
  return debtSkill.getDebtsByPerson(userId, personId);
}

export function listAllDebts(userId: number, limit?: number): Promise<ExpenseDebt[]> {
  return debtSkill.listAllDebts(userId, limit);
}

export function saveContext(userId: number, debtId: number, context: unknown): Promise<ExpenseDebt | undefined> {
  return debtSkill.saveContext(userId, debtId, context);
}

export function saveDraftMessage(
  userId: number,
  debtId: number,
  patch: { message: string; tone: string | null; edited: boolean }
): Promise<ExpenseDebt | undefined> {
  return debtSkill.saveDraftMessage(userId, debtId, patch);
}

export function markPaid(userId: number, debtId: number, status: DebtStatus = "PAID"): Promise<ExpenseDebt | undefined> {
  return debtSkill.markPaid(userId, debtId, status);
}

export function removeDebt(userId: number, debtId: number): Promise<boolean> {
  return debtSkill.removeDebt(userId, debtId);
}
