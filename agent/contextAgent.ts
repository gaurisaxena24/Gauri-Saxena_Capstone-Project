/**
 * Context Agent — the addressable interface debtCollectorAgent (Main Agent)
 * calls to build the AI's context object for a debt, purely from what's
 * already in the database. Delegates to skills/contextSkill.ts.
 */

import { buildReminderContext } from "../skills/contextSkill.js";
import type { ReminderContext } from "../backend/ai/types.js";
import type { Expense, ExpenseDebt, Person } from "../backend/database/database.js";

export function buildContext(params: { person: Person; expense: Expense; debt: ExpenseDebt }): Promise<ReminderContext> {
  return buildReminderContext(params);
}
