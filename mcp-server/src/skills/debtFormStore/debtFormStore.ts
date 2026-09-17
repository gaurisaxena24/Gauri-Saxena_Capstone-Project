/**
 * In-memory session state for the Unhinged Debt Collector Skill's
 * step-by-step form. One session per Telegram chat, mirroring the
 * in-memory Map pattern used by ../../draftStore.ts.
 */

export interface DebtFormFields {
  person_name?: string;
  telegram_username?: string;
  amount_owed?: string;
  debt_reason?: string;
  overdue_duration?: string;
  relationship?: string;
  previously_reminded?: boolean;
  previous_reminder_count?: number;
  additional_context?: string;
  tone?: string;
}

export interface DebtFormSession {
  chatId: string | number;
  /** Index into the ordered question list; see debtCollectorSkill.ts. */
  step: number;
  fields: DebtFormFields;
  createdAt: number;
}

const sessions = new Map<string, DebtFormSession>();

function key(chatId: string | number): string {
  return String(chatId);
}

export function startSession(chatId: string | number): DebtFormSession {
  const session: DebtFormSession = {
    chatId,
    step: 0,
    fields: {},
    createdAt: Date.now(),
  };
  sessions.set(key(chatId), session);
  return session;
}

export function getSession(chatId: string | number): DebtFormSession | undefined {
  return sessions.get(key(chatId));
}

export function clearSession(chatId: string | number): void {
  sessions.delete(key(chatId));
}

/** TEMPORARY DEBUG HELPER — remove once the multi-step loop is fully verified. */
export function debugListSessions(): DebtFormSession[] {
  return Array.from(sessions.values());
}
