import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listDebts, removeDebt, type DebtSummary } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";

export function Debts() {
  const [debts, setDebts] = useState<DebtSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function load() {
    setError(null);
    listDebts()
      .then((res) => setDebts(res.debts))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load debts."));
  }

  useEffect(load, []);

  async function handleRemove(debt: DebtSummary) {
    const label = debt.personName
      ? `${debt.personName} — ${debt.expenseMerchant ?? debt.expenseCategory ?? "expense"} (${formatCurrency(debt.amount)})`
      : "this invalid request";
    if (!window.confirm(`Remove this send request?\n\n${label}\n\nThis only removes the request — the person and expense are not affected.`)) {
      return;
    }
    setRemoveError(null);
    setRemovingId(debt.id);
    try {
      await removeDebt(debt.id);
      setDebts((prev) => prev?.filter((d) => d.id !== debt.id) ?? prev);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Couldn't remove this request.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl font-bold text-ink">Debts</h1>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {removeError && <div className="mb-4"><ErrorBanner message={removeError} /></div>}

      {debts && debts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No debts yet.
        </div>
      )}

      <div className="space-y-3">
        {debts?.map((debt) => {
          // A debt whose person lookup failed (e.g. the person no longer exists) — the only case
          // this data model can produce for an otherwise-valid debt row.
          const invalid = !debt.personName;
          return (
            <div
              key={debt.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
            >
              {invalid ? (
                <div className="flex-1 text-sm">
                  <p className="font-medium text-[var(--color-danger)]">⚠ Invalid request</p>
                  <p className="text-ink-faint">Person or expense could not be found.</p>
                </div>
              ) : (
                <Link to={`/debts/${debt.id}`} className="flex flex-1 items-center justify-between gap-3 hover:opacity-80">
                  <div>
                    <p className="font-medium text-ink">{debt.personName}</p>
                    <p className="text-sm text-ink-faint">
                      {debt.expenseMerchant ?? debt.expenseCategory ?? "Expense"} · {formatDate(debt.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={debt.status} />
                    <span className="w-20 text-right font-medium text-ink">{formatCurrency(debt.amount)}</span>
                  </div>
                </Link>
              )}
              <button
                type="button"
                onClick={() => handleRemove(debt)}
                disabled={removingId === debt.id}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
              >
                {removingId === debt.id ? "Removing…" : "Remove"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
