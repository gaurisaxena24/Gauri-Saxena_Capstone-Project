/**
 * Reminder Agent — the addressable interface debtCollectorAgent (Main Agent)
 * calls to record and query the permanent send-attempt history. Delegates
 * to skills/reminderSkill.ts. A row is only ever written once telegramAgent
 * has actually tried to deliver a message.
 */

import * as reminderSkill from "../skills/reminderSkill.js";
import type { Reminder, ReminderStatus } from "../backend/database/database.js";

export function logReminder(input: {
  debtId: number;
  personId: number;
  message: string;
  tone: string | null;
  status: ReminderStatus;
  telegramMessageId?: string | number | null;
}): Reminder {
  return reminderSkill.logReminder(input);
}

export function historyForDebt(debtId: number): Reminder[] {
  return reminderSkill.historyForDebt(debtId);
}

export function historyForPerson(personId: number): Reminder[] {
  return reminderSkill.historyForPerson(personId);
}

export function allReminders(limit?: number): Reminder[] {
  return reminderSkill.allReminders(limit);
}
