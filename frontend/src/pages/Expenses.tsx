import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listExpenses, removeExpense, type Expense } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

export function Expenses() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function load() {
    setError(null);
    listExpenses()
      .then((res) => setExpenses(res.expenses))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load expenses."));
  }

  useEffect(load, []);

  async function handleRemove(expense: Expense) {
    const label = `${expense.merchant ?? expense.category ?? "this expense"} (${formatCurrency(expense.total)})`;
    if (!window.confirm(`Remove this expense?\n\n${label}\n\nThis does not affect any person. If a debt is still drafted from it, removal will be blocked until that debt is removed first.`)) {
      return;
    }
    setRemoveError(null);
    setRemovingId(expense.id);
    try {
      await removeExpense(expense.id);
      setExpenses((prev) => prev?.filter((e) => e.id !== expense.id) ?? prev);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Couldn't remove this expense.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl font-bold text-ink">Expenses</h1>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {removeError && <div className="mb-4"><ErrorBanner message={removeError} /></div>}

      {expenses && expenses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No expenses yet.
        </div>
      )}

      <div className="space-y-3">
        {expenses?.map((expense) => (
          <div
            key={expense.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <Link
              to={`/expenses/${expense.id}`}
              className="flex flex-1 items-center justify-between gap-3 hover:opacity-80"
            >
              <div>
                <p className="font-medium text-ink">{expense.merchant ?? expense.category ?? "Expense"}</p>
                <p className="text-sm text-ink-faint">
                  {expense.source === "MANUAL" ? "Entered manually" : "From a screenshot"} · {formatDate(expense.date ?? expense.createdAt)}
                </p>
              </div>
              <span className="font-medium text-ink">{formatCurrency(expense.total)}</span>
            </Link>
            <button
              type="button"
              onClick={() => handleRemove(expense)}
              disabled={removingId === expense.id}
              className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
            >
              {removingId === expense.id ? "Removing…" : "Remove"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
