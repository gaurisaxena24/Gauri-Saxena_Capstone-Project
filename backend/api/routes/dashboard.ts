import { Router } from "express";
import { getDashboardStats, type ExpenseDebt } from "../../database/database.js";
import * as debtSkill from "../../../skills/debtSkill.js";
import * as profileSkill from "../../../skills/profileSkill.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";

export const dashboardRouter = Router();

async function toRecentDebt(userId: number, debt: ExpenseDebt) {
  const [expense, person] = await Promise.all([
    debtSkill.getExpenseById(userId, debt.expense_id),
    profileSkill.findPersonById(userId, debt.person_id),
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

dashboardRouter.get("/", async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const [stats, recentDebts] = await Promise.all([getDashboardStats(userId), debtSkill.listAllDebts(userId, 5)]);
  const recent = await Promise.all(recentDebts.map((d) => toRecentDebt(userId, d)));
  res.json({ stats, recent });
});
