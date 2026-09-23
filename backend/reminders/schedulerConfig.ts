/**
 * The single source of truth for how often an automatic follow-up reminder fires for a debt, once
 * its first reminder has been manually approved and sent. Every place that needs this number
 * (the scheduler's own timing logic in backend/reminders/scheduler.ts, the due-debts DB query in
 * backend/database/database.ts, and the "Automatic reminders: every N minutes" UI text surfaced via
 * GET /api/health) reads it from here — never a separately hardcoded "5" anywhere else. Changing the
 * real cadence later (e.g. to 1440 for once a day) is a one-line change to the default below, or an
 * `REMINDER_INTERVAL_MINUTES` env var override with no code change at all.
 */

export const DEFAULT_REMINDER_INTERVAL_MINUTES = 5;

export function getReminderIntervalMinutes(): number {
  const raw = process.env.REMINDER_INTERVAL_MINUTES;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REMINDER_INTERVAL_MINUTES;
}

/** Same env-var-with-fallback shape as above, for the independent Gmail payment-scan interval (see
 * backend/gmail/scanScheduler.ts) — a Gmail inbox check has a completely different natural cadence
 * than the reminder poll, so it gets its own config rather than reusing REMINDER_INTERVAL_MINUTES. */
export const DEFAULT_GMAIL_SCAN_INTERVAL_MINUTES = 5;

export function getGmailScanIntervalMinutes(): number {
  const raw = process.env.GMAIL_SCAN_INTERVAL_MINUTES;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GMAIL_SCAN_INTERVAL_MINUTES;
}
