/**
 * Reminder Skill — the permanent send-attempt history. A row here is only
 * ever written once telegramSkill has actually tried to deliver a message;
 * a SENT row is only ever written after a genuinely successful send.
 */

import {
  getRemindersForDebt,
  getRemindersForPerson,
  listReminders,
  recordReminder,
  type Reminder,
  type ReminderStatus,
} from "../backend/database/database.js";

export function logReminder(input: {
  debtId: number;
  personId: number;
  message: string;
  tone: string | null;
  status: ReminderStatus;
  telegramMessageId?: string | number | null;
}): Reminder {
  return recordReminder(input);
}

export function historyForDebt(debtId: number): Reminder[] {
  return getRemindersForDebt(debtId);
}

export function historyForPerson(personId: number): Reminder[] {
  return getRemindersForPerson(personId);
}

export function allReminders(limit?: number): Reminder[] {
  return listReminders(limit);
}
