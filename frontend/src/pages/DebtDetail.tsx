import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, getDebt, getHealth, markDebtPaid, removeDebt, type DebtDetail as DebtDetailData } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { ToneBadge } from "../components/ToneBadge";
import { ErrorBanner } from "../components/ErrorBanner";

export function DebtDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [debt, setDebt] = useState<DebtDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Single source of truth is the backend's REMINDER_INTERVAL_MINUTES (backend/reminders/schedulerConfig.ts).
  const [reminderIntervalMinutes, setReminderIntervalMinutes] = useState(5);

  function load() {
    setError(null);
    getDebt(Number(id))
      .then(setDebt)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this debt."));
  }

  useEffect(load, [id]);
  useEffect(() => {
    getHealth()
      .then((health) => setReminderIntervalMinutes(health.reminderIntervalMinutes))
      .catch(() => {});
  }, []);

  // Automatic mode begins the moment a debt's first reminder is actually sent, and only ever ends
  // when the debt is marked paid (backend/reminders/scheduler.ts) — no separate flag to read here.
  const automaticRemindersActive = Boolean(
    debt && debt.status === "UNPAID" && debt.reminders.some((r) => r.status === "SENT")
  );

  async function handleMarkPaid() {
    if (!debt) return;
    setMarkingPaid(true);
    try {
      const updated = await markDebtPaid(debt.id);
      setDebt({ ...debt, ...updated });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update status.");
    } finally {
      setMarkingPaid(false);
    }
  }

  async function handleRemove() {
    if (!debt) return;
    const label = debt.personName
      ? `${debt.personName} — ${debt.expenseMerchant ?? debt.expenseCategory ?? "expense"} (${formatCurrency(debt.amount)})`
      : "this invalid request";
    if (!window.confirm(`Remove this send request?\n\n${label}\n\nThis only removes the request — the person and expense are not affected.`)) {
      return;
    }
    setRemoving(true);
    try {
      await removeDebt(debt.id);
      navigate("/debts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove this request.");
      setRemoving(false);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!debt) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/debts" className="text-sm text-ink-soft hover:text-ink">
        ← All debts
      </Link>

      <div className="mt-3 mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{debt.personName}</h1>
          <p className="text-sm text-ink-faint">
            {debt.expenseMerchant ?? debt.expenseCategory ?? "Expense"} · {formatDate(debt.createdAt)}
          </p>
        </div>
        <StatusBadge status={debt.status} />
      </div>

      {automaticRemindersActive && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-ink">
          <span className="font-medium">Automatic reminders:</span> every {reminderIntervalMinutes} minute
          {reminderIntervalMinutes === 1 ? "" : "s"} (test mode), escalating in tone, until this is marked as paid.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">Amount owed</h2>
          <p className="font-display text-2xl font-bold text-ink">{formatCurrency(debt.amount)}</p>
          {debt.person && (
            <>
              <p className="mt-1 text-sm text-ink-faint">
                {debt.person.name} · @{debt.person.telegramUsername} · {debt.person.relationship ?? "—"}
              </p>
              {debt.person.notes && <p className="mt-1 text-sm text-ink-soft">{debt.person.notes}</p>}
            </>
          )}
          {debt.expenseId && (
            <Link to={`/expenses/${debt.expenseId}`} className="mt-2 inline-block text-sm text-ink-soft underline hover:text-ink">
              View source expense
            </Link>
          )}
        </div>

        {debt.context && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">AI context used</h2>
            <dl className="space-y-1 text-sm">
              <Row label="Share" value={`${debt.context.debt.shareMode} of ${formatCurrency(debt.context.debt.expenseTotal)}`} />
              <Row label="Previous debts" value={String(debt.context.history.previousDebts)} />
              <Row label="Previous reminders" value={String(debt.context.history.previousReminders)} />
              <Row label="Previously paid" value={String(debt.context.history.previousPaidDebts)} />
              <Row label="Days outstanding" value={String(debt.context.history.daysOutstanding)} />
              {debt.context.history.lastReminderTone && (
                <Row label="Tone last used" value={debt.context.history.lastReminderTone} />
              )}
              {debt.context.debt.desiredAction && <Row label="Requested action" value={debt.context.debt.desiredAction} />}
            </dl>
            {debt.context.debt.items && debt.context.debt.items.length > 0 && (
              <div className="mt-3 border-t border-border pt-3 text-sm text-ink-soft">
                <span className="text-ink-faint">Covers items: </span>
                {debt.context.debt.items.map((i) => `${i.name} (${formatCurrency(i.amount)})`).join(", ")}
              </div>
            )}
            {debt.context.history.otherOpenDebts && debt.context.history.otherOpenDebts.length > 0 && (
              <div className="mt-3 border-t border-border pt-3 text-sm text-ink-soft">
                <span className="text-ink-faint">Also owes for: </span>
                {debt.context.history.otherOpenDebts.map((d) => `${d.reason} (${formatCurrency(d.amount)})`).join(", ")}
              </div>
            )}
            {debt.context.person.description && (
              <p className="mt-3 border-t border-border pt-3 text-sm text-ink-soft">
                <span className="text-ink-faint">Person description used: </span>
                {debt.context.person.description}
              </p>
            )}
            {debt.context.debt.additionalContext && (
              <p className="mt-2 text-sm text-ink-soft">
                <span className="text-ink-faint">Additional context used: </span>
                {debt.context.debt.additionalContext}
              </p>
            )}
          </div>
        )}
      </div>

      {debt.message && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Reminder message</h2>
            <div className="flex items-center gap-2">
              <ToneBadge tone={debt.tone} />
              {debt.messageEdited && <span className="text-xs text-ink-faint">edited by you</span>}
            </div>
          </div>
          <p className="font-display text-lg leading-relaxed text-ink">"{debt.message}"</p>
        </div>
      )}

      {debt.reminders.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">Send history</h2>
          <div className="space-y-2">
            {debt.reminders.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-sm">
                <span className={r.status === "SENT" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
                  {r.status === "SENT" ? "Sent" : "Failed"}
                </span>
                <span className="text-ink-faint">{formatDate(r.sentAt ?? r.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {debt.status === "UNPAID" && (
          <button
            type="button"
            onClick={handleMarkPaid}
            disabled={markingPaid}
            className="rounded-full border border-border px-5 py-2 text-sm font-medium text-ink hover:border-ink/40 disabled:opacity-40"
          >
            {markingPaid ? "Updating…" : "Mark as paid"}
          </button>
        )}
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="rounded-full border border-border px-5 py-2 text-sm font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
        >
          {removing ? "Removing…" : "Remove request"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
