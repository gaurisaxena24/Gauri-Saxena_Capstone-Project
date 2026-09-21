import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ApiError,
  generateMessage,
  getExpense,
  getHealth,
  listExpenses,
  markDebtPaid,
  removeExpense,
  sendDebtViaTelegram,
  type Expense,
  type ExpenseDebtDetail,
} from "../api/client";
import { formatCurrency, formatDate, formatDateTime } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { ToneBadge } from "../components/ToneBadge";
import { ErrorBanner } from "../components/ErrorBanner";

interface DebtActionState {
  sending?: boolean;
  markingPaid?: boolean;
  error?: string | null;
}

/**
 * Grouped by expense, not by person or a standalone debt/reminder page: each expense is one card,
 * and everyone who owes money from it — their amount, paid/unpaid status, generated reminder
 * message, and full send history — lives nested directly inside that same card. Expanding is all
 * done in place (local state below); nothing here navigates to another page.
 */
export function Expenses() {
  const { id: focusId } = useParams();
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeErrors, setRemoveErrors] = useState<Record<number, string>>({});

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [debtsByExpense, setDebtsByExpense] = useState<Record<number, ExpenseDebtDetail[]>>({});
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [loadErrors, setLoadErrors] = useState<Record<number, string>>({});

  const [expandedDebtIds, setExpandedDebtIds] = useState<Set<number>>(new Set());
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<number>>(new Set());
  const [debtActions, setDebtActions] = useState<Record<number, DebtActionState>>({});

  const [reminderIntervalMinutes, setReminderIntervalMinutes] = useState(5);

  const focusedRef = useRef<HTMLDivElement | null>(null);
  const didFocus = useRef(false);

  function load() {
    setError(null);
    listExpenses()
      .then((res) => setExpenses(res.expenses))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load expenses."));
  }

  useEffect(load, []);
  useEffect(() => {
    getHealth()
      .then((health) => setReminderIntervalMinutes(health.reminderIntervalMinutes))
      .catch(() => {});
  }, []);

  async function loadDebts(expenseId: number) {
    setLoadingIds((prev) => new Set(prev).add(expenseId));
    setLoadErrors((prev) => {
      const next = { ...prev };
      delete next[expenseId];
      return next;
    });
    try {
      const full = await getExpense(expenseId);
      setDebtsByExpense((prev) => ({ ...prev, [expenseId]: full.debts }));
    } catch (err) {
      setLoadErrors((prev) => ({
        ...prev,
        [expenseId]: err instanceof Error ? err.message : "Couldn't load who owes on this expense.",
      }));
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(expenseId);
        return next;
      });
    }
  }

  function toggleExpense(expenseId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(expenseId)) {
        next.delete(expenseId);
      } else {
        next.add(expenseId);
        if (!debtsByExpense[expenseId]) void loadDebts(expenseId);
      }
      return next;
    });
  }

  // Deep link from elsewhere (e.g. a person's debt history) — auto-expand and scroll to it once,
  // rather than landing on a separate expense page.
  useEffect(() => {
    if (!focusId || !expenses || didFocus.current) return;
    const targetId = Number(focusId);
    if (!expenses.some((e) => e.id === targetId)) return;
    didFocus.current = true;
    setExpandedIds((prev) => new Set(prev).add(targetId));
    if (!debtsByExpense[targetId]) void loadDebts(targetId);
    setTimeout(() => focusedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, expenses]);

  function toggleDebt(debtId: number) {
    setExpandedDebtIds((prev) => {
      const next = new Set(prev);
      if (next.has(debtId)) next.delete(debtId);
      else next.add(debtId);
      return next;
    });
  }

  function toggleHistory(debtId: number) {
    setExpandedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(debtId)) next.delete(debtId);
      else next.add(debtId);
      return next;
    });
  }

  function updateDebt(expenseId: number, debtId: number, patch: Partial<ExpenseDebtDetail>) {
    setDebtsByExpense((prev) => ({
      ...prev,
      [expenseId]: (prev[expenseId] ?? []).map((d) => (d.id === debtId ? { ...d, ...patch } : d)),
    }));
  }

  function setDebtAction(debtId: number, patch: DebtActionState) {
    setDebtActions((prev) => ({ ...prev, [debtId]: { ...prev[debtId], ...patch } }));
  }

  /** Only meaningful for a debt's very first reminder — once one has actually SENT, the automatic
   * scheduler owns all further follow-ups for that debt (and the backend's own send endpoint is a
   * no-op if it's already been sent once), so this only ever runs for a never-sent debt. */
  async function handleSendReminder(expenseId: number, debt: ExpenseDebtDetail) {
    setDebtAction(debt.id, { sending: true, error: null });
    let sendError: string | null = null;
    try {
      if (!debt.message) {
        await generateMessage(debt.id);
      }
      await sendDebtViaTelegram(debt.id);
    } catch (err) {
      sendError =
        err instanceof ApiError && err.notVerified
          ? `${err.message} (this person hasn't verified their Telegram yet)`
          : err instanceof Error
          ? err.message
          : "Couldn't send the reminder.";
    }
    try {
      const full = await getExpense(expenseId);
      const refreshed = full.debts.find((d) => d.id === debt.id);
      if (refreshed) updateDebt(expenseId, debt.id, refreshed);
    } catch {
      // Best-effort refresh — the send error (if any) above is still shown.
    }
    setDebtAction(debt.id, { sending: false, error: sendError });
  }

  async function handleMarkPaid(expenseId: number, debt: ExpenseDebtDetail) {
    setDebtAction(debt.id, { markingPaid: true, error: null });
    try {
      const updated = await markDebtPaid(debt.id);
      updateDebt(expenseId, debt.id, { status: updated.status, paidAt: updated.paidAt });
      setDebtAction(debt.id, { markingPaid: false });
    } catch (err) {
      setDebtAction(debt.id, {
        markingPaid: false,
        error: err instanceof Error ? err.message : "Couldn't update status.",
      });
    }
  }

  async function handleRemove(expense: Expense) {
    const label = `${expense.merchant ?? expense.category ?? "this expense"} (${formatCurrency(expense.total)})`;
    if (
      !window.confirm(
        `Remove this expense?\n\n${label}\n\nIf anyone still owes money from it, you'll need to remove their debt first — this does not silently delete debt records. This does not affect any person.`
      )
    ) {
      return;
    }
    setRemoveErrors((prev) => {
      const next = { ...prev };
      delete next[expense.id];
      return next;
    });
    setRemovingId(expense.id);
    try {
      await removeExpense(expense.id);
      setExpenses((prev) => prev?.filter((e) => e.id !== expense.id) ?? prev);
    } catch (err) {
      setRemoveErrors((prev) => ({
        ...prev,
        [expense.id]: err instanceof Error ? err.message : "Couldn't remove this expense.",
      }));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl font-bold text-ink">Expenses</h1>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {expenses && expenses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No expenses yet.
        </div>
      )}

      <div className="space-y-3">
        {expenses?.map((expense) => {
          const expanded = expandedIds.has(expense.id);
          const debts = debtsByExpense[expense.id];
          const loadingDebts = loadingIds.has(expense.id);
          const isFocused = Boolean(focusId) && Number(focusId) === expense.id;
          return (
            <div
              key={expense.id}
              ref={isFocused ? focusedRef : undefined}
              className={`rounded-2xl border bg-card ${isFocused ? "border-accent" : "border-border"}`}
            >
              <button
                type="button"
                onClick={() => toggleExpense(expense.id)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
              >
                <div>
                  <p className="font-medium text-ink">{expense.merchant ?? expense.category ?? "Expense"}</p>
                  <p className="text-sm text-ink-faint">
                    {formatDate(expense.date ?? expense.createdAt)}
                    {debts && debts.length > 0 ? ` · ${debts.length} ${debts.length === 1 ? "person" : "people"}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-ink">{formatCurrency(expense.total)}</span>
                  <span className={`text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
                </div>
              </button>

              {expanded && (
                <div className="space-y-4 border-t border-border p-4">
                  {removeErrors[expense.id] && <ErrorBanner message={removeErrors[expense.id]} />}

                  {(expense.category || expense.tax !== null || expense.tip !== null || expense.paymentMethod) && (
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
                      {expense.category && <span>Category: {expense.category}</span>}
                      {expense.tax !== null && <span>Tax: {formatCurrency(expense.tax)}</span>}
                      {expense.tip !== null && <span>Tip: {formatCurrency(expense.tip)}</span>}
                      {expense.paymentMethod && <span>Paid via {expense.paymentMethod}</span>}
                    </div>
                  )}

                  {expense.imageUrl && (
                    <img
                      src={expense.imageUrl}
                      alt="Source"
                      className="max-h-56 w-full rounded-xl border border-border bg-paper object-contain"
                    />
                  )}

                  {expense.lineItems.length > 0 && (
                    <div>
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Items</h3>
                      <ul className="divide-y divide-border text-sm">
                        {expense.lineItems.map((item, i) => (
                          <li key={i} className="flex items-center justify-between py-1.5">
                            <span className="text-ink-soft">{item.name}</span>
                            <span className="font-medium text-ink">{formatCurrency(item.price)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {expense.description && <p className="text-sm text-ink-soft">{expense.description}</p>}

                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      Who owes from this expense
                    </h3>
                    {loadingDebts && <p className="text-sm text-ink-faint">Loading…</p>}
                    {loadErrors[expense.id] && (
                      <ErrorBanner message={loadErrors[expense.id]} onRetry={() => loadDebts(expense.id)} />
                    )}
                    {debts && debts.length === 0 && (
                      <p className="text-sm text-ink-faint">No one owes anything from this expense.</p>
                    )}
                    {debts && debts.length > 0 && (
                      <div className="space-y-2">
                        {debts.map((debt) => (
                          <DebtRow
                            key={debt.id}
                            debt={debt}
                            expanded={expandedDebtIds.has(debt.id)}
                            historyExpanded={expandedHistoryIds.has(debt.id)}
                            action={debtActions[debt.id] ?? {}}
                            reminderIntervalMinutes={reminderIntervalMinutes}
                            onToggle={() => toggleDebt(debt.id)}
                            onToggleHistory={() => toggleHistory(debt.id)}
                            onSend={() => handleSendReminder(expense.id, debt)}
                            onMarkPaid={() => handleMarkPaid(expense.id, debt)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemove(expense)}
                    disabled={removingId === expense.id}
                    className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
                  >
                    {removingId === expense.id ? "Removing…" : "Remove expense"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DebtRow({
  debt,
  expanded,
  historyExpanded,
  action,
  reminderIntervalMinutes,
  onToggle,
  onToggleHistory,
  onSend,
  onMarkPaid,
}: {
  debt: ExpenseDebtDetail;
  expanded: boolean;
  historyExpanded: boolean;
  action: DebtActionState;
  reminderIntervalMinutes: number;
  onToggle: () => void;
  onToggleHistory: () => void;
  onSend: () => void;
  onMarkPaid: () => void;
}) {
  const sentReminders = debt.reminders.filter((r) => r.status === "SENT");
  const latestSent = sentReminders[0] ?? null;
  const hasSentBefore = sentReminders.length > 0;
  const automaticActive = debt.status === "UNPAID" && hasSentBefore;
  // The scheduler fires the next follow-up once `reminderIntervalMinutes` have passed since the
  // last one actually sent (backend/reminders/scheduler.ts) — this is that same math, client-side,
  // purely for display.
  const nextReminderAt =
    automaticActive && latestSent
      ? new Date(new Date(latestSent.sentAt ?? latestSent.createdAt).getTime() + reminderIntervalMinutes * 60_000)
      : null;

  return (
    <div className="rounded-xl border border-border bg-paper">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-3 text-left">
        <p className="font-medium text-ink">{debt.personName ?? "Unknown person"}</p>
        <div className="flex items-center gap-2">
          <StatusBadge status={debt.status} />
          <span className="font-medium text-ink">{formatCurrency(debt.amount)}</span>
          <span className={`text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
        </div>
      </button>

      {/* Reminder status/history stays visible for this person's debt without needing to expand
          the row first — it never lives on a separate, all-reminders page. */}
      <div className="space-y-2 border-t border-border px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Reminder</p>
          <p className="text-sm text-ink-soft">
            {latestSent ? `Sent ${formatDateTime(latestSent.sentAt ?? latestSent.createdAt)}` : "Not sent yet"}
          </p>
        </div>

        {automaticActive && (
          <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-ink">
            <p className="font-medium">Automatic reminders active</p>
            {nextReminderAt && <p>Next reminder: {formatDateTime(nextReminderAt.toISOString())}</p>}
          </div>
        )}

        {debt.status === "PAID" && debt.paidAt && <p className="text-xs text-ink-faint">Paid {formatDateTime(debt.paidAt)}</p>}

        {debt.reminders.length > 0 && (
          <div>
            <button
              type="button"
              onClick={onToggleHistory}
              className="text-xs font-medium text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              Reminder history {historyExpanded ? "▴" : "▾"} ({debt.reminders.length})
            </button>
            {historyExpanded && (
              <div className="mt-2 space-y-2">
                {debt.reminders.map((r) => (
                  <div key={r.id} className="rounded-lg bg-ink/[0.03] p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className={r.status === "SENT" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
                        {r.status === "SENT" ? "Sent" : "Failed"}
                      </span>
                      <span className="text-ink-faint">{formatDateTime(r.sentAt ?? r.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-ink-soft">"{r.message}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border p-3">
          {action.error && <ErrorBanner message={action.error} />}

          {debt.message && (
            <div>
              <div className="mb-1 flex items-center gap-2">
                <ToneBadge tone={debt.tone} />
                {debt.messageEdited && <span className="text-xs text-ink-faint">edited by you</span>}
              </div>
              <p className="text-sm leading-relaxed text-ink-soft">"{debt.message}"</p>
            </div>
          )}

          {debt.status === "UNPAID" && (
            <div className="flex flex-wrap gap-2">
              {!hasSentBefore && (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={action.sending}
                  className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-paper disabled:opacity-40"
                >
                  {action.sending ? "Sending…" : "Send reminder"}
                </button>
              )}
              <button
                type="button"
                onClick={onMarkPaid}
                disabled={action.markingPaid}
                className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-ink hover:border-ink/40 disabled:opacity-40"
              >
                {action.markingPaid ? "Updating…" : "Mark as paid"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
