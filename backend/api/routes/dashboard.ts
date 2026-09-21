import { Router } from "express";
import { getDashboardStats, type ExpenseDebt } from "../../database/database.js";
import * as debtSkill from "../../../skills/debtSkill.js";
import * as profileSkill from "../../../skills/profileSkill.js";

export const dashboardRouter = Router();

async function toRecentDebt(debt: ExpenseDebt) {
  const [expense, person] = await Promise.all([
    debtSkill.getExpenseById(debt.expense_id),
    profileSkill.findPersonById(debt.person_id),
  ]);
  return {
    id: debt.id,
    // No standalone debt page exists any more — the frontend links this row to the person's
    // profile page instead, which already lists this debt in their debt history.
    personId: person ? debt.person_id : null,
    personName: person?.name ?? null,
    amount: debt.amount,
    status: debt.status,
    createdAt: debt.created_at,
    merchant: expense?.merchant ?? null,
  };
}

dashboardRouter.get("/", async (_req, res) => {
  const [stats, recentDebts] = await Promise.all([getDashboardStats(), debtSkill.listAllDebts(5)]);
  const recent = await Promise.all(recentDebts.map(toRecentDebt));
  res.json({ stats, recent });
});
