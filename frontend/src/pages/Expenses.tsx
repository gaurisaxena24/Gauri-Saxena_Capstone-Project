import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listExpenses, type Expense } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

export function Expenses() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    listExpenses()
      .then((res) => setExpenses(res.expenses))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load expenses."));
  }

  useEffect(load, []);

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
        {expenses?.map((expense) => (
          <Link
            key={expense.id}
            to={`/expenses/${expense.id}`}
            className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 hover:border-ink/30"
          >
            <div>
              <p className="font-medium text-ink">{expense.merchant ?? expense.category ?? "Expense"}</p>
              <p className="text-sm text-ink-faint">
                {expense.source === "MANUAL" ? "Entered manually" : "From a screenshot"} · {formatDate(expense.date ?? expense.createdAt)}
              </p>
            </div>
            <span className="font-medium text-ink">{formatCurrency(expense.total)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
