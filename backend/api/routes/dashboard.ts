import { Router } from "express";
import { getDashboardStats, type ExpenseDebt } from "../../database/database.js";
import * as debtSkill from "../../../skills/debtSkill.js";
import * as profileSkill from "../../../skills/profileSkill.js";

export const dashboardRouter = Router();

function toRecentDebt(debt: ExpenseDebt) {
  const expense = debtSkill.getExpenseById(debt.expense_id);
  const person = profileSkill.findPersonById(debt.person_id);
  return {
    id: debt.id,
    personName: person?.name ?? null,
    amount: debt.amount,
    status: debt.status,
    createdAt: debt.created_at,
    merchant: expense?.merchant ?? null,
  };
}

dashboardRouter.get("/", (_req, res) => {
  const stats = getDashboardStats();
  const recent = debtSkill.listAllDebts(5).map(toRecentDebt);
  res.json({ stats, recent });
});
