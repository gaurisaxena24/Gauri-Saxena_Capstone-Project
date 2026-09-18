import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listDebts, type DebtSummary } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";

export function Debts() {
  const [debts, setDebts] = useState<DebtSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    listDebts()
      .then((res) => setDebts(res.debts))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load debts."));
  }

  useEffect(load, []);

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl font-bold text-ink">Debts</h1>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {debts && debts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No debts yet.
        </div>
      )}

      <div className="space-y-3">
        {debts?.map((debt) => (
          <Link
            key={debt.id}
            to={`/debts/${debt.id}`}
            className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 hover:border-ink/30"
          >
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
        ))}
      </div>
    </div>
  );
}
