/**
 * Independent timer for the Gmail payment scanner (backend/gmail/paymentScanner.ts) — deliberately
 * separate from backend/reminders/scheduler.ts's timer, not folded into its tick loop: a Gmail
 * inbox check has a completely different natural cadence than the 5-15s reminder poll, and a slow
 * Gmail API call shouldn't stall or be stalled by it. Activation mirrors
 * shouldRunReminderScheduler() in backend/index.ts for the same "only one process may act" reason —
 * running this on both a local dev instance and the deployed instance at once would double-process
 * the same emails against the same database (harmless in effect, since gmail_processed_messages
 * dedupes either way, but wasteful and noisy).
 */

import { listUsersWithGmailConnected } from "../database/database.js";
import { scanUserGmailForPayments } from "./paymentScanner.js";
import { getGmailScanIntervalMinutes } from "../reminders/schedulerConfig.js";

export async function runGmailScanTick(): Promise<void> {
  let users;
  try {
    users = await listUsersWithGmailConnected();
  } catch (error) {
    console.error("[gmail-scan] Failed to list Gmail-connected users:", error);
    return;
  }

  for (const user of users) {
    await scanUserGmailForPayments(user);
  }
}

let scanTimer: NodeJS.Timeout | undefined;

export function startGmailScanScheduler(): void {
  if (scanTimer) return;
  const intervalMinutes = getGmailScanIntervalMinutes();
  console.log(`[gmail-scan] Starting: checking connected Gmail accounts every ${intervalMinutes} minute(s).`);
  scanTimer = setInterval(() => {
    void runGmailScanTick();
  }, intervalMinutes * 60_000);
  void runGmailScanTick();
}

export function stopGmailScanScheduler(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = undefined;
  }
}
