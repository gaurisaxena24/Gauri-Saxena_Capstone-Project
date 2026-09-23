/**
 * Reminder Agent — the addressable interface debtCollectorAgent (Main Agent)
 * calls to record and query the permanent send-attempt history. Delegates
 * to skills/reminderSkill.ts. A row is only ever written once telegramAgent
 * has actually tried to deliver a message.
 */

import * as reminderSkill from "../skills/reminderSkill.js";
import type { Reminder, ReminderStatus } from "../backend/database/database.js";

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
  return reminderSkill.logReminder(userId, input);
}

export function historyForDebt(userId: number, debtId: number): Promise<Reminder[]> {
  return reminderSkill.historyForDebt(userId, debtId);
}

export function historyForPerson(userId: number, personId: number): Promise<Reminder[]> {
  return reminderSkill.historyForPerson(userId, personId);
}

export function allReminders(userId: number, limit?: number): Promise<Reminder[]> {
  return reminderSkill.allReminders(userId, limit);
}
