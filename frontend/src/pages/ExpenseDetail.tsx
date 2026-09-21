import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getExpense, removeExpense, type Expense } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

const SOURCE_LABEL: Record<Expense["source"], string> = {
  MANUAL: "Entered manually",
  IMAGE: "Read from an image",
};

export function ExpenseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [expense, setExpense] = useState<(Expense & { debtIds: number[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [removing, setRemoving] = useState(false);

  function load() {
    setError(null);
    getExpense(Number(id))
      .then(setExpense)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this expense."));
  }

  useEffect(load, [id]);

  async function handleRemove() {
    if (!expense) return;
    const label = expense.merchant ?? expense.category ?? "this expense";
    if (expense.debtIds.length > 0) {
      window.alert(
        `This expense still has ${expense.debtIds.length} debt(s) drafted from it. Remove ${
          expense.debtIds.length === 1 ? "it" : "them"
        } first (below), then you can delete this expense.`
      );
      return;
    }
    if (!window.confirm(`Remove ${label} (${formatCurrency(expense.total)})?\n\nThis does not affect any person.`)) return;
    setRemoving(true);
    try {
      await removeExpense(expense.id);
      navigate("/expenses");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove this expense.");
      setRemoving(false);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!expense) return null;

  const note = expense.description;
  const noteIsLong = Boolean(note && note.length > 220);
  const facts: Array<{ label: string; value: string }> = [
    { label: "Category", value: expense.category ?? "—" },
    ...(expense.paymentMethod ? [{ label: "Payment method", value: expense.paymentMethod }] : []),
    ...(expense.transactionReference ? [{ label: "Reference", value: expense.transactionReference }] : []),
    ...(expense.visibleNames.length > 0 ? [{ label: "Names visible", value: expense.visibleNames.join(", ") }] : []),
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/expenses" className="text-sm text-ink-soft hover:text-ink">
        ← All expenses
      </Link>

      {/* Hero */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-ink-faint">{expense.merchant ? "Paid to" : "Expense"}</p>
            <h1 className="font-display text-2xl font-bold text-ink">
              {expense.merchant ?? expense.category ?? "Expense"}
            </h1>
          </div>
          <span className="shrink-0 rounded-full bg-ink/5 px-3 py-1 text-xs font-medium text-ink-soft">
            {SOURCE_LABEL[expense.source]}
            {expense.extractionMethod ? ` · ${expense.extractionMethod === "ocr" ? "OCR + AI" : "AI vision"}` : ""}
          </span>
        </div>

        <p className="font-display mt-4 text-4xl font-bold text-ink">{formatCurrency(expense.total)}</p>
        <p className="mt-1 text-sm text-ink-faint">{formatDate(expense.date ?? expense.createdAt)}</p>

        {(expense.tax !== null || expense.tip !== null) && (
          <div className="mt-4 flex gap-6 border-t border-border pt-4 text-sm">
            {expense.tax !== null && (
              <div>
                <p className="text-ink-faint">Tax</p>
                <p className="font-medium text-ink">{formatCurrency(expense.tax)}</p>
              </div>
            )}
            {expense.tip !== null && (
              <div>
                <p className="text-ink-faint">Tip</p>
                <p className="font-medium text-ink">{formatCurrency(expense.tip)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {expense.imageUrl && (
        <img
          src={expense.imageUrl}
          alt="Source"
          className="mt-4 max-h-72 w-full rounded-2xl border border-border object-contain bg-card"
        />
      )}

      {facts.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">Details</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="flex items-baseline justify-between gap-3 sm:justify-start">
                <dt className="text-ink-faint">{fact.label}</dt>
                <dd className="text-right font-medium text-ink sm:text-left">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {expense.lineItems.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">Items</h2>
          <ul className="divide-y divide-border text-sm">
            {expense.lineItems.map((item, i) => (
              <li key={i} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                <span className="text-ink-soft">{item.name}</span>
                <span className="font-medium text-ink">{formatCurrency(item.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {note && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">Note</h2>
          <p
            className={`whitespace-pre-line text-sm leading-relaxed text-ink-soft ${
              noteIsLong && !noteExpanded ? "line-clamp-3" : ""
            }`}
          >
            {note}
          </p>
          {noteIsLong && (
            <button
              onClick={() => setNoteExpanded((v) => !v)}
              className="mt-2 text-xs font-medium text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink hover:no-underline"
            >
              {noteExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {expense.debtIds.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">Debts from this expense</h2>
          <div className="space-y-2">
            {expense.debtIds.map((debtId) => (
              <Link
                key={debtId}
                to={`/debts/${debtId}`}
                className="block rounded-xl border border-border bg-card p-3 text-sm text-ink transition-colors hover:border-ink/30"
              >
                View debt #{debtId}
              </Link>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleRemove}
        disabled={removing}
        className="mt-6 rounded-full border border-border px-5 py-2 text-sm font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
      >
        {removing ? "Removing…" : "Remove expense"}
      </button>
    </div>
  );
}
