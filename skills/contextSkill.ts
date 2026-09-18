/**
 * Context Skill — builds the AI's context object purely from what's already
 * in the database. Never invents a conversation, promise, excuse, emotion,
 * or event that isn't a stored or directly-derived fact.
 */

import { getRemindersForPerson, type Expense, type ExpenseDebt, type Person } from "../backend/database/database.js";
import { getDebtsByPerson } from "./debtSkill.js";
import type { ReminderContext } from "../backend/ai/types.js";

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
}

export function buildReminderContext(params: {
  person: Person;
  expense: Expense;
  debt: ExpenseDebt;
}): ReminderContext {
  const { person, expense, debt } = params;
  const priorDebts = getDebtsByPerson(person.id).filter((d) => d.id !== debt.id);
  const priorReminders = getRemindersForPerson(person.id).filter(
    (r) => r.status === "SENT" && r.debt_id !== debt.id
  );

  return {
    person: {
      name: person.name,
      telegramUsername: person.telegram_username,
      relationship: person.relationship ?? "friend",
    },
    debt: {
      amount: debt.amount,
      currency: debt.currency ?? expense.currency ?? "INR",
      date: expense.expense_date,
      category: expense.category,
      reason: expense.description ?? expense.merchant ?? expense.category ?? "a shared expense",
    },
    history: {
      previousDebts: priorDebts.length,
      previousReminders: priorReminders.length,
      previousPaidDebts: priorDebts.filter((d) => d.status === "PAID").length,
      daysOutstanding: daysBetween(new Date(debt.created_at), new Date()),
    },
  };
}
