/**
 * Debt Agent — the addressable interface debtCollectorAgent (Main Agent)
 * calls for everything about expenses and the per-person debts they create.
 * Delegates to skills/debtSkill.ts for the actual persistence.
 */

import * as debtSkill from "../skills/debtSkill.js";
import type { NewExpenseInput } from "../skills/debtSkill.js";
import type { DebtStatus, Expense, ExpenseDebt, ExpenseLineItem, ShareModeValue } from "../backend/database/database.js";

export type { NewExpenseInput };

export function recordExpense(input: NewExpenseInput): Expense {
  return debtSkill.recordExpense(input);
}

export function getExpenseById(id: number): Expense | undefined {
  return debtSkill.getExpenseById(id);
}

export function listAllExpenses(limit?: number): Expense[] {
  return debtSkill.listAllExpenses(limit);
}

export function removeExpense(id: number): { imagePath: string | null } | undefined {
  return debtSkill.removeExpense(id);
}

export function editExpense(
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
): Expense | undefined {
  return debtSkill.editExpense(id, patch);
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
  selectedItems?: Array<{ name: string; amount: number }> | null;
}): ExpenseDebt {
  return debtSkill.attachDebt(input);
}

export function getDebt(id: number): ExpenseDebt | undefined {
  return debtSkill.getDebt(id);
}

export function getDebtsByExpense(expenseId: number): ExpenseDebt[] {
  return debtSkill.getDebtsByExpense(expenseId);
}

export function getDebtsByPerson(personId: number): ExpenseDebt[] {
  return debtSkill.getDebtsByPerson(personId);
}

export function listAllDebts(limit?: number): ExpenseDebt[] {
  return debtSkill.listAllDebts(limit);
}

export function saveContext(debtId: number, context: unknown): ExpenseDebt | undefined {
  return debtSkill.saveContext(debtId, context);
}

export function saveDraftMessage(
  debtId: number,
  patch: { message: string; tone: string | null; edited: boolean }
): ExpenseDebt | undefined {
  return debtSkill.saveDraftMessage(debtId, patch);
}

export function markPaid(debtId: number, status: DebtStatus = "PAID"): ExpenseDebt | undefined {
  return debtSkill.markPaid(debtId, status);
}

export function removeDebt(debtId: number): boolean {
  return debtSkill.removeDebt(debtId);
}
