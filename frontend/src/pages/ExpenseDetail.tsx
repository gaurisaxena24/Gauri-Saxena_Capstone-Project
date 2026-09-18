import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getExpense, type Expense } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

export function ExpenseDetail() {
  const { id } = useParams();
  const [expense, setExpense] = useState<(Expense & { debtIds: number[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    getExpense(Number(id))
      .then(setExpense)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this expense."));
  }

  useEffect(load, [id]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!expense) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/expenses" className="text-sm text-ink-soft hover:text-ink">
        ← All expenses
      </Link>

      <div className="mt-3 mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">{expense.merchant ?? expense.category ?? "Expense"}</h1>
        <p className="text-sm text-ink-faint">
          {expense.source === "MANUAL" ? "Entered manually" : `Read from an image via ${expense.extractionMethod ?? "AI"}`} ·{" "}
          {formatDate(expense.date ?? expense.createdAt)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {expense.imageUrl && (
          <img src={expense.imageUrl} alt="Source" className="max-h-72 w-full rounded-xl border border-border object-contain" />
        )}
        <div className="space-y-1 rounded-2xl border border-border bg-card p-5 text-sm">
          <Row label="Total" value={formatCurrency(expense.total)} />
          {expense.tax !== null && <Row label="Tax" value={formatCurrency(expense.tax)} />}
          {expense.tip !== null && <Row label="Tip" value={formatCurrency(expense.tip)} />}
          <Row label="Category" value={expense.category ?? "—"} />
          {expense.paymentMethod && <Row label="Payment method" value={expense.paymentMethod} />}
          {expense.transactionReference && <Row label="Reference" value={expense.transactionReference} />}
          {expense.description && <Row label="Description" value={expense.description} />}
          {expense.visibleNames.length > 0 && <Row label="Names visible" value={expense.visibleNames.join(", ")} />}
        </div>
      </div>

      {expense.lineItems.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">Items</h2>
          <ul className="space-y-1 text-sm">
            {expense.lineItems.map((item, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-ink-soft">{item.name}</span>
                <span className="text-ink">{formatCurrency(item.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {expense.debtIds.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">Debts from this expense</h2>
          <div className="space-y-2">
            {expense.debtIds.map((debtId) => (
              <Link
                key={debtId}
                to={`/debts/${debtId}`}
                className="block rounded-xl border border-border bg-card p-3 text-sm text-ink hover:border-ink/30"
              >
                View debt #{debtId}
              </Link>
            ))}
          </div>
        </div>
      )}
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
