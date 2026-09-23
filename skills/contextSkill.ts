/**
 * Context Skill — builds the AI's context object purely from what's already
 * in the database. Never invents a conversation, promise, excuse, emotion,
 * or event that isn't a stored or directly-derived fact.
 */

import {
  getRemindersForDebt,
  getRemindersForPerson,
  type Expense,
  type ExpenseDebt,
  type Person,
} from "../backend/database/database.js";
import { getDebtsByPerson, getExpenseById } from "./debtSkill.js";
import { shouldStayFormal } from "./formalitySkill.js";
import { TONES, type ReminderContext, type Tone } from "../backend/ai/types.js";

function isTone(value: string | null): value is Tone {
  return value !== null && (TONES as readonly string[]).includes(value);
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
}

const MAX_REASON_LENGTH = 60;

/**
 * `expense.description` is meant to be a short human summary, but some older/OCR-derived rows
 * ended up storing a raw multi-line receipt dump instead. This is the AI prompt's own reason
 * string, not a UI display field with its own cap — defensively short regardless of how dirty the
 * underlying data is, so a stray receipt dump never floods the model's context.
 */
function shortReason(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_REASON_LENGTH ? `${oneLine.slice(0, MAX_REASON_LENGTH).trim()}…` : oneLine;
}

export async function buildReminderContext(
  userId: number,
  params: {
    person: Person;
    expense: Expense;
    debt: ExpenseDebt;
  }
): Promise<ReminderContext> {
  const { person, expense, debt } = params;
  const [allDebts, allReminders, remindersForThisDebt] = await Promise.all([
    getDebtsByPerson(userId, person.id),
    getRemindersForPerson(userId, person.id),
    getRemindersForDebt(userId, debt.id),
  ]);
  const priorDebts = allDebts.filter((d) => d.id !== debt.id);
  // getRemindersForPerson orders newest-first, so this filter preserves that order — [0] is the
  // most recently sent reminder to this person, for anything but the debt being messaged about now.
  const priorReminders = allReminders.filter((r) => r.status === "SENT" && r.debt_id !== debt.id);
  const lastReminderTone = isTone(priorReminders[0]?.tone ?? null) ? (priorReminders[0].tone as Tone) : null;

  // Same-debt history — deliberately the OPPOSITE filter from `priorReminders` above: this is what
  // automatic escalation needs (see backend/ai/types.ts's `ReminderContext.history.remindersForThisDebt`
  // doc comment for why the two must stay separate). getRemindersForDebt orders newest-first too, so
  // [0] is the most recently sent reminder for this exact debt.
  const sentForThisDebt = remindersForThisDebt.filter((r) => r.status === "SENT");
  const lastToneForThisDebt = isTone(sentForThisDebt[0]?.tone ?? null) ? (sentForThisDebt[0].tone as Tone) : null;

  const otherOpenDebts = await Promise.all(
    priorDebts
      .filter((d) => d.status === "UNPAID")
      .slice(0, 5)
      .map(async (d) => {
        const otherExpense = await getExpenseById(userId, d.expense_id);
        return {
          amount: d.amount,
          reason: shortReason(
            otherExpense?.description ?? otherExpense?.merchant ?? otherExpense?.category ?? "a shared expense"
          ),
          daysOutstanding: daysBetween(new Date(d.created_at), new Date()),
        };
      })
  );

  return {
    person: {
      name: person.name,
      telegramUsername: person.telegram_username,
      relationship: person.relationship ?? "friend",
      description: person.notes ?? null,
      formalityLocked: shouldStayFormal(person),
    },
    debt: {
      amount: debt.amount,
      expenseTotal: expense.total,
      currency: debt.currency ?? expense.currency ?? "INR",
      date: expense.expense_date,
      category: expense.category,
      reason: shortReason(expense.description ?? expense.merchant ?? expense.category ?? "a shared expense"),
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
      remindersForThisDebt: sentForThisDebt.length,
      lastToneForThisDebt,
    },
  };
}
