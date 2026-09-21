import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboard, type DashboardData } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="font-display mt-1 text-3xl font-bold text-ink">{value}</p>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    getDashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load dashboard."));
  }

  useEffect(load, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">Dashboard</h1>
        <Link
          to="/add-expense"
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.02]"
        >
          + Add Expense
        </Link>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total outstanding" value={formatCurrency(data.stats.totalOwed)} />
            <StatCard label="People owing" value={String(data.stats.peopleOwing)} />
            <StatCard label="Reminders sent" value={String(data.stats.remindersSent)} />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">Recent debts</h2>
            {data.recent.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
                No expenses yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-ink-faint">
                      <th className="px-4 py-3 font-medium">Person</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((debt) => (
                      <tr key={debt.id} className="border-b border-border last:border-0 hover:bg-ink/[0.02]">
                        <td className="px-4 py-3">
                          <Link to={`/debts/${debt.id}`} className="font-medium text-ink hover:text-accent">
                            {debt.personName}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{formatCurrency(debt.amount)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={debt.status} />
                        </td>
                        <td className="px-4 py-3 text-ink-soft">{formatDate(debt.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
