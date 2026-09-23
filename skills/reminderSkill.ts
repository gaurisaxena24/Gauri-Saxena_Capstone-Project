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

export function logReminder(
  userId: number,
  input: {
    debtId: number;
    personId: number;
    message: string;
    tone: string | null;
    status: ReminderStatus;
    telegramMessageId?: string | number | null;
  }
): Promise<Reminder> {
  return recordReminder(userId, input);
}

export function historyForDebt(userId: number, debtId: number): Promise<Reminder[]> {
  return getRemindersForDebt(userId, debtId);
}

export function historyForPerson(userId: number, personId: number): Promise<Reminder[]> {
  return getRemindersForPerson(userId, personId);
}

export function allReminders(userId: number, limit?: number): Promise<Reminder[]> {
  return listReminders(userId, limit);
}
