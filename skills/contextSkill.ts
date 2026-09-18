/**
 * Context Skill — builds the AI's context object purely from what's already
 * in the database. Never invents a conversation, promise, excuse, emotion,
 * or event that isn't a stored or directly-derived fact.
 */

import { getRemindersForPerson, type Expense, type ExpenseDebt, type Person } from "../backend/database/database.js";
import { getDebtsByPerson, getExpenseById } from "./debtSkill.js";
import { TONES, type ReminderContext, type Tone } from "../backend/ai/types.js";

function isTone(value: string | null): value is Tone {
  return value !== null && (TONES as readonly string[]).includes(value);
}

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
  // getRemindersForPerson orders newest-first, so this filter preserves that order — [0] is the
  // most recently sent reminder to this person, for anything but the debt being messaged about now.
  const priorReminders = getRemindersForPerson(person.id).filter(
    (r) => r.status === "SENT" && r.debt_id !== debt.id
  );
  const lastReminderTone = isTone(priorReminders[0]?.tone ?? null) ? (priorReminders[0].tone as Tone) : null;

  const otherOpenDebts = priorDebts
    .filter((d) => d.status === "UNPAID")
    .slice(0, 5)
    .map((d) => {
      const otherExpense = getExpenseById(d.expense_id);
      return {
        amount: d.amount,
        reason: otherExpense?.description ?? otherExpense?.merchant ?? otherExpense?.category ?? "a shared expense",
        daysOutstanding: daysBetween(new Date(d.created_at), new Date()),
      };
    });

  return {
    person: {
      name: person.name,
      telegramUsername: person.telegram_username,
      relationship: person.relationship ?? "friend",
      description: person.notes ?? null,
    },
    debt: {
      amount: debt.amount,
      expenseTotal: expense.total,
      currency: debt.currency ?? expense.currency ?? "INR",
      date: expense.expense_date,
      category: expense.category,
      reason: expense.description ?? expense.merchant ?? expense.category ?? "a shared expense",
      shareMode: debt.share_mode ?? "FULL",
      additionalContext: debt.additional_context,
      desiredAction: debt.desired_action,
      items: debt.selected_items_json ? JSON.parse(debt.selected_items_json) : null,
    },
    history: {
      previousDebts: priorDebts.length,
      previousReminders: priorReminders.length,
      previousPaidDebts: priorDebts.filter((d) => d.status === "PAID").length,
      daysOutstanding: daysBetween(new Date(debt.created_at), new Date()),
      lastReminderTone,
      otherOpenDebts,
    },
  };
}
