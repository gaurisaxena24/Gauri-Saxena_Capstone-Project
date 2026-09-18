import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listReminders, type ReminderSummary } from "../api/client";
import { formatDate } from "../lib/format";
import { ToneBadge } from "../components/ToneBadge";
import { ErrorBanner } from "../components/ErrorBanner";

export function Reminders() {
  const [reminders, setReminders] = useState<ReminderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    listReminders()
      .then((res) => setReminders(res.reminders))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load reminders."));
  }

  useEffect(load, []);

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl font-bold text-ink">Reminders</h1>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {reminders && reminders.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No reminders sent yet.
        </div>
      )}

      <div className="space-y-3">
        {reminders?.map((r) => (
          <Link
            key={r.id}
            to={`/debts/${r.debtId}`}
            className="block rounded-2xl border border-border bg-card p-4 hover:border-ink/30"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium text-ink">{r.personName ?? "Unknown"}</p>
              <div className="flex items-center gap-2">
                <ToneBadge tone={r.tone} />
                <span
                  className={`text-xs font-medium ${
                    r.status === "SENT" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                  }`}
                >
                  {r.status === "SENT" ? "Sent" : "Failed"}
                </span>
              </div>
            </div>
            <p className="text-sm text-ink-soft">"{r.message}"</p>
            <p className="mt-1 text-xs text-ink-faint">{formatDate(r.sentAt ?? r.createdAt)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
