import { useState } from "react";
import { Link } from "react-router-dom";
import {
  markDebtPaid,
  syncDebtWithGmail,
  type GmailSyncResult,
  type GmailSyncSummary,
} from "../api/client";
import { formatDateTime } from "../lib/format";

/**
 * The "Sync" button + result UI for one unpaid debt — checks the user's connected Gmail for
 * evidence this specific debt was paid (see backend/api/routes/debts.ts's POST /:debtId/sync).
 * Deliberately self-contained and reused everywhere an unpaid debt row renders (Expenses.tsx,
 * PersonDetail.tsx): each instance owns its own request-in-flight guard, so double-clicking Sync
 * (or having several debt rows on screen) can never fire two overlapping requests for the same
 * debt, and a result here only ever updates this one debt's own row via `onSynced`/`onMarkedPaid` —
 * never a whole-list refetch.
 *
 * When Sync finds a payment email matching on all three signals (person/name + date + exact
 * amount), the backend marks the debt paid in that same request and this row flips to Paid
 * immediately via `onMarkedPaid`. No match → the debt stays unpaid.
 */
export function GmailSyncControl({
  debtId,
  gmailSync,
  onSynced,
  onMarkedPaid,
}: {
  debtId: number;
  /** The persisted result of the last completed sync on this debt (if any) — null if "Sync" has
   * never been used. */
  gmailSync: GmailSyncSummary | null;
  /** Called only when a sync actually completed with a real answer (PAYMENT_FOUND /
   * POSSIBLE_PAYMENT / NO_PAYMENT_FOUND) — updates just this debt's stored sync summary. */
  onSynced: (summary: GmailSyncSummary) => void;
  /** Called when the debt becomes paid — either Sync matched a payment email, or "Mark as Paid" on
   * an older POSSIBLE_PAYMENT result succeeded. Lets the caller update this one debt's status/paidAt. */
  onMarkedPaid: (paidAt: string | null) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [live, setLive] = useState<GmailSyncResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    if (syncing) return; // guards against a double-click firing two overlapping requests
    setSyncing(true);
    setError(null);
    setDismissed(false);
    setExpanded(false);
    try {
      const result = await syncDebtWithGmail(debtId);
      setLive(result);
      if (result.status === "PAYMENT_FOUND" || result.status === "POSSIBLE_PAYMENT" || result.status === "NO_PAYMENT_FOUND") {
        onSynced({
          status: result.status,
          checkedAt: result.checkedAt ?? new Date().toISOString(),
          confidence: result.confidence ?? null,
          emailId: result.emailId ?? null,
          emailDate: result.emailDate ?? null,
          sender: result.sender ?? null,
          subject: result.subject ?? null,
          reason: result.reason ?? null,
        });
      }
      if (result.debtStatus === "PAID") {
        // Matched on name + date + exact amount — the backend already marked it paid; flip the row now.
        onMarkedPaid(result.paidAt ?? new Date().toISOString());
      }
    } catch (err) {
      // Network/auth failures at the fetch layer itself (not the backend's own SYNC_ERROR status,
      // which already comes back as a normal 200 response) — same generic, non-technical copy.
      setError(err instanceof Error ? err.message : "Couldn't check Gmail — try again in a moment.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleMarkPaid() {
    setMarkingPaid(true);
    setError(null);
    try {
      const updated = await markDebtPaid(debtId);
      onMarkedPaid(updated.paidAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't mark as paid.");
    } finally {
      setMarkingPaid(false);
    }
  }

  // What to actually render: a just-finished sync (`live`) takes priority over the persisted
  // summary from a previous visit, so the UI never shows a stale status right after a fresh check.
  const shown: GmailSyncResult | null = live ?? (gmailSync ? { ...gmailSync } : null);

  return (
    <div>
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-ink-soft hover:border-ink/40 hover:text-ink disabled:opacity-40"
      >
        {syncing ? "Checking Gmail…" : gmailSync ? "Sync again" : "Sync"}
      </button>

      {gmailSync?.checkedAt && !syncing && !live && (
        <p className="mt-1 text-[11px] text-ink-faint">Last checked: {formatDateTime(gmailSync.checkedAt)}</p>
      )}

      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}

      {!dismissed && shown && !syncing && (
        <GmailSyncResultPanel
          result={shown}
          expanded={expanded}
          onToggleExpand={() => setExpanded((v) => !v)}
          markingPaid={markingPaid}
          onMarkPaid={handleMarkPaid}
          onDismiss={() => {
            setDismissed(true);
            setLive(null);
          }}
        />
      )}
    </div>
  );
}

function GmailSyncResultPanel({
  result,
  expanded,
  onToggleExpand,
  markingPaid,
  onMarkPaid,
  onDismiss,
}: {
  result: GmailSyncResult;
  expanded: boolean;
  onToggleExpand: () => void;
  markingPaid: boolean;
  onMarkPaid: () => void;
  onDismiss: () => void;
}) {
  if (result.status === "GMAIL_NOT_CONNECTED") {
    return (
      <div className="mt-2 rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-xs text-[var(--color-accent-dark)]">
        Gmail isn't connected yet.{" "}
        <Link to="/settings" className="font-medium underline decoration-dotted underline-offset-2">
          Connect it in Settings
        </Link>{" "}
        to check for payment emails.
      </div>
    );
  }

  if (result.status === "GMAIL_PERMISSION_REQUIRED") {
    return (
      <div className="mt-2 rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-xs text-[var(--color-accent-dark)]">
        Gmail access needs to be reconnected.{" "}
        <Link to="/settings" className="font-medium underline decoration-dotted underline-offset-2">
          Reconnect it in Settings
        </Link>
        , then try syncing again.
      </div>
    );
  }

  if (result.status === "SYNC_ERROR") {
    return (
      <div className="mt-2 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
        Couldn't check Gmail — try again in a moment.
      </div>
    );
  }

  if (result.status === "NO_PAYMENT_FOUND") {
    return (
      <p className="mt-2 text-xs text-ink-faint">
        No payment email matched this person, date and exact amount — still unpaid.
      </p>
    );
  }

  if (result.status === "POSSIBLE_PAYMENT") {
    return (
      <div className="mt-2 rounded-lg bg-[var(--color-accent-soft)] p-3 text-xs text-[var(--color-accent-dark)]">
        <p className="font-medium">Possible payment found</p>
        <p className="mt-1 text-ink-soft">
          {result.reason || "We found an email that may indicate this was paid, but we couldn't confirm it with certainty."}
        </p>
        <EmailMeta result={result} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onMarkPaid}
            disabled={markingPaid}
            className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-paper disabled:opacity-40"
          >
            {markingPaid ? "Updating…" : "Mark as Paid"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full border border-border px-3 py-1 text-xs font-medium text-ink-soft hover:border-ink/40"
          >
            Not This Payment
          </button>
        </div>
      </div>
    );
  }

  // PAYMENT_FOUND
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggleExpand}
        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-badge-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-success-badge-text)]"
      >
        ✓ Payment found {expanded ? "▴" : "›"}
      </button>
      {expanded && (
        <div className="mt-2 rounded-lg bg-[var(--color-success-badge-bg)] p-3 text-xs text-ink">
          <p>{result.reason || "This email looks like strong evidence this was paid."}</p>
          <EmailMeta result={result} />
          <button
            type="button"
            onClick={onMarkPaid}
            disabled={markingPaid}
            className="mt-2 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-paper disabled:opacity-40"
          >
            {markingPaid ? "Updating…" : "Mark as Paid"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Never the email body — only enough to let the user recognize which email this was. */
function EmailMeta({ result }: { result: GmailSyncResult }) {
  if (!result.sender && !result.emailDate && !result.subject) return null;
  return (
    <p className="mt-1 text-ink-soft">
      {result.sender && <>From: {result.sender}</>}
      {result.sender && result.emailDate && " · "}
      {result.emailDate && <>Date: {result.emailDate}</>}
      {(result.sender || result.emailDate) && result.subject && " · "}
      {result.subject && <>Subject: {result.subject}</>}
    </p>
  );
}
