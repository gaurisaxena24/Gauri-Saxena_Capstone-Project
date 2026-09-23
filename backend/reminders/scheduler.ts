/**
 * Reminder Scheduler — once a debt's FIRST reminder has been manually approved and actually sent
 * (see backend/api/routes/debts.ts's POST /:id/send), this module takes over and generates + sends
 * escalating follow-up reminders automatically, on a timer, with no further human approval, until
 * the debt is marked PAID. There is no separate "cancel" flag: the only stop condition is the
 * debt's own `status` (see getDebtsDueForAutomaticFollowUp / the re-check in `processDebt` below).
 *
 * Reuses the exact same machinery the manual flow already uses for every step — this file only
 * decides WHEN to act and WITH WHICH FORCED TONE:
 *  - contextAgent.buildContext (skills/contextSkill.ts) for fresh context every single tick, never
 *    a stale cached one, so `history.remindersForThisDebt` always reflects reality right before
 *    generating.
 *  - skills/escalationSkill.ts to turn that fresh reminder count into a forced tone + stage note.
 *  - debtCollectorAgent.generateDraft (→ messageDraftAgent → skills/messageDraftSkill.ts → Groq) for
 *    the actual message text — the same "no em/en dashes, no corporate language, no fixed
 *    templates" generation the manual first reminder uses.
 *  - debtCollectorAgent.sendReminder (→ telegramAgent → skills/telegramSkill.ts, then
 *    reminderAgent.logReminder → recordReminder) for the actual send + audit-log row.
 *
 * Activation mirrors backend/index.ts's `shouldPollTelegram()` exactly, and for the same reason:
 * this is another "only one process may act" problem. Telegram only allows one active poller per
 * bot token, and in the same way, running this scheduler in both a local dev instance and the
 * deployed Railway instance at once would let both fire the same debt's follow-up simultaneously,
 * double-sending. See `shouldRunReminderScheduler()` in backend/index.ts.
 */

import * as agent from "../../agent/debtCollectorAgent.js";
import * as contextAgent from "../../agent/contextAgent.js";
import * as profileSkill from "../../skills/profileSkill.js";
import * as debtSkill from "../../skills/debtSkill.js";
import { escalationForFollowUp } from "../../skills/escalationSkill.js";
import { shouldStayFormal } from "../../skills/formalitySkill.js";
import { getDebtsDueForAutomaticFollowUp, type ExpenseDebt } from "../database/database.js";
import { getReminderIntervalMinutes } from "./schedulerConfig.js";
import { groqCooldownRemainingMs } from "../ai/groqClient.js";

/** Never fires more than once per debt at a time, even if a tick takes longer than the poll cadence. */
const debtsCurrentlyProcessing = new Set<number>();

/**
 * A debt whose follow-up keeps failing (Groq down, Telegram rejecting the send, missing data) is
 * retried after 1, 2, 4, 8… minutes, capped at 30, instead of on every 15s poll — the old behavior
 * retried one failing debt ~240 times an hour and burned the whole daily Groq token budget. Cleared
 * as soon as that debt succeeds. In-memory only: a restart simply retries once, then backs off again.
 */
const failureBackoff = new Map<number, { failures: number; nextAttemptMs: number }>();
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

function recordFailure(debtId: number): void {
  const failures = (failureBackoff.get(debtId)?.failures ?? 0) + 1;
  const delayMs = Math.min(BASE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
  failureBackoff.set(debtId, { failures, nextAttemptMs: Date.now() + delayMs });
  console.error(`[reminder-scheduler] Debt ${debtId} failed ${failures} time(s) in a row — next try in ${Math.round(delayMs / 60_000)} min.`);
}

function isBackingOff(debtId: number): boolean {
  const entry = failureBackoff.get(debtId);
  return Boolean(entry && Date.now() < entry.nextAttemptMs);
}

/** Logged once per Groq pause rather than on every 15s poll. */
let loggedGroqPause = false;

async function processDebt(userId: number, debtId: number): Promise<void> {
  if (debtsCurrentlyProcessing.has(debtId) || isBackingOff(debtId)) return;
  debtsCurrentlyProcessing.add(debtId);
  try {
    const debt = await debtSkill.getDebt(userId, debtId);
    if (!debt || debt.status !== "UNPAID") return; // already paid / removed since the query ran

    const [expense, person] = await Promise.all([
      debtSkill.getExpenseById(userId, debt.expense_id),
      profileSkill.findPersonById(userId, debt.person_id),
    ]);
    if (!expense || !person) {
      console.error(`[reminder-scheduler] Debt ${debtId} is missing its expense or person — skipping.`);
      return;
    }

    // Always fresh — never the context cached on the debt row at attach-time — so
    // history.remindersForThisDebt/lastToneForThisDebt reflect every reminder sent so far,
    // including ones this scheduler itself already sent on earlier ticks.
    const context = await contextAgent.buildContext(userId, { person, expense, debt });
    const escalation = escalationForFollowUp(context.history.remindersForThisDebt, shouldStayFormal(person));

    // Persist the refreshed context too, so DebtDetail's "AI context used" panel stays accurate
    // for a debt that's been sitting in automatic mode for a while, exactly like the one-time
    // context built at attach-time already does for the first reminder.
    const debtWithFreshContext = (await debtSkill.saveContext(userId, debt.id, context)) ?? debt;

    const { debt: withDraft } = await agent.generateDraft(userId, {
      debt: debtWithFreshContext,
      context,
      forcedTone: escalation.tone,
      escalationNote: escalation.note,
    });

    // Close the race window between this tick starting and the user clicking "Mark as paid" — the
    // debt is re-checked immediately before the actual send, not just once at the top of this
    // function (generation above can take a couple of seconds against the real Groq API).
    const latest = await debtSkill.getDebt(userId, debt.id);
    if (!latest || latest.status !== "UNPAID") {
      console.log(`[reminder-scheduler] Debt ${debtId} was marked paid mid-cycle — not sending.`);
      return;
    }

    const result = await agent.sendReminder(userId, withDraft, person);
    if (result.success) {
      failureBackoff.delete(debtId);
      console.log(
        `[reminder-scheduler] Sent automatic follow-up (stage ${escalation.stage}, tone ${escalation.tone}) for debt ${debtId}.`
      );
    } else {
      console.error(`[reminder-scheduler] Automatic follow-up send failed for debt ${debtId}: ${result.error}`);
      recordFailure(debtId);
    }
  } catch (error) {
    console.error(`[reminder-scheduler] Failed to process debt ${debtId}:`, error);
    recordFailure(debtId);
  } finally {
    debtsCurrentlyProcessing.delete(debtId);
  }
}

export async function runReminderSchedulerTick(): Promise<void> {
  // Every follow-up needs Groq to write the message — while Groq has asked us to wait (e.g. the daily
  // token limit is used up), don't even try. Due debts are simply picked up on the first tick after.
  const groqPausedMs = groqCooldownRemainingMs();
  if (groqPausedMs > 0) {
    if (!loggedGroqPause) {
      console.log(`[reminder-scheduler] Groq is rate-limited — pausing follow-ups for ${Math.ceil(groqPausedMs / 60_000)} min.`);
      loggedGroqPause = true;
    }
    return;
  }
  loggedGroqPause = false;

  const intervalMinutes = getReminderIntervalMinutes();
  const cutoffIso = new Date(Date.now() - intervalMinutes * 60_000).toISOString();

  let due: ExpenseDebt[];
  try {
    due = await getDebtsDueForAutomaticFollowUp(cutoffIso);
  } catch (error) {
    console.error("[reminder-scheduler] Failed to query debts due for a follow-up:", error);
    return;
  }

  for (const debt of due) {
    // getDebtsDueForAutomaticFollowUp deliberately sweeps every tenant's due debts each tick (see
    // its own doc comment) — each row already carries its owning user_id, so that's what scopes
    // every downstream lookup back to the correct tenant.
    await processDebt(debt.user_id, debt.id);
  }
}

let schedulerTimer: NodeJS.Timeout | undefined;

/**
 * Polls much more often than `REMINDER_INTERVAL_MINUTES` itself so a debt that becomes due between
 * ticks is caught quickly rather than waiting up to a full extra poll cycle — the actual per-debt
 * cadence is still governed entirely by the DB query's cutoff timestamp, not by how often this poll
 * runs. Reproduced directly against the real app: a 60s poll cap let a self-reinforcing drift creep
 * in (each reminder consistently landing ~60s late, so the "5 minute" cadence crept to a stable 6
 * minutes). Capped at 15s instead, so real-world drift stays under ~15s per cycle. Floored at 5s so a
 * very short interval used for local testing still polls at a sane rate rather than hammering the
 * database.
 */
function pollIntervalMs(reminderIntervalMs: number): number {
  return Math.max(5_000, Math.min(reminderIntervalMs, 15_000));
}

export function startReminderScheduler(): void {
  if (schedulerTimer) return;
  const intervalMinutes = getReminderIntervalMinutes();
  const intervalMs = intervalMinutes * 60_000;
  const pollMs = pollIntervalMs(intervalMs);
  console.log(
    `[reminder-scheduler] Starting: automatic follow-ups every ${intervalMinutes} minute(s) per debt (polling every ${Math.round(
      pollMs / 1000
    )}s).`
  );
  schedulerTimer = setInterval(() => {
    void runReminderSchedulerTick();
  }, pollMs);
  void runReminderSchedulerTick();
}

export function stopReminderScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = undefined;
  }
}
