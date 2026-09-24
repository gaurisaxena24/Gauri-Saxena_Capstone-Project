import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboard, listPeople, type DashboardData, type PersonSummary } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";
import { useAuth } from "../context/AuthContext";

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** One cheeky line, built only from real numbers — never an invented fact. */
function tagline(totalOwed: number, peopleOwing: number, top: PersonSummary | null, remindersSent: number): string {
  if (totalOwed <= 0) return "Nobody owes you a single rupee. Suspicious, but we'll allow it.";
  if (top && peopleOwing > 1) return `${top.name.split(" ")[0]} is leading the "I'll pay you later" league at ${formatCurrency(top.totalOwed)}.`;
  if (top) return `It's all ${top.name.split(" ")[0]}. Every last rupee. Keep the pressure on.`;
  if (remindersSent === 0) return "No reminders sent yet. They think you forgot.";
  return "The reminders are climbing. Somebody's phone is getting spicy.";
}

function StatCard({ label, value, hint, to }: { label: string; value: string; hint?: string; to?: string }) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className="font-display mt-3 truncate text-3xl font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-ink-soft">{hint}</p>}
    </>
  );
  const cls = "block rounded-2xl border border-border bg-card p-6";
  return to ? (
    <Link to={to} className={`${cls} transition-transform hover:-translate-y-0.5`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Shown once, right after a fresh sign-up (see Login.tsx) — the account's only recovery code,
  // otherwise just sitting quietly in Settings. Read from sessionStorage rather than router state:
  // the /login route's own declarative redirect (see App.tsx: user becomes truthy -> <Navigate
  // to="/dashboard" replace/>) fires as soon as login() sets the user, racing any state Login.tsx
  // would try to attach to its own navigate() call.
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    try {
      const code = sessionStorage.getItem("udc.newRecoveryCode");
      if (code) {
        setNewRecoveryCode(code);
        sessionStorage.removeItem("udc.newRecoveryCode");
      }
    } catch {
      // ignore corrupted/blocked storage — worst case the one-time banner just doesn't show
    }
  }, []);

  function load() {
    setError(null);
    getDashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load dashboard."));
    // Only powers the hero's "biggest debtor" line — the dashboard still renders if this fails.
    listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => setPeople([]));
  }

  useEffect(load, []);

  // Reminders only count while someone still owes — 0 once everything is paid. (The backend counts
  // only reminders on unpaid debts; this guard covers an older backend that counted every reminder.)
  const remindersSent = data && data.stats.totalOwed > 0 ? data.stats.remindersSent : 0;
  const allSettled = !data || data.stats.totalOwed <= 0;
  const top = people.filter((p) => p.totalOwed > 0).sort((a, b) => b.totalOwed - a.totalOwed)[0] ?? null;
  const name = user?.name ?? "there";

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-soft">
        {greeting()}, <span className="font-semibold text-ink">{name}</span>
      </p>

      {newRecoveryCode && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-accent/30 bg-accent/10 p-4">
          <p className="text-sm text-ink">
            Save your recovery code — it's the only way back into this account from another
            browser or device: <span className="font-display font-semibold tracking-wide">{newRecoveryCode}</span>.
            You can find it again anytime in Settings.
          </p>
          <button
            type="button"
            onClick={() => setNewRecoveryCode(null)}
            className="shrink-0 text-xs font-medium text-ink-faint hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}

      {data && (
        <>
          {/* Hero — the one loud thing on the page. Fixed dark panel in both themes. */}
          <section className="relative overflow-hidden rounded-[1.75rem] bg-[#16171b] p-7 ring-1 ring-white/[0.06] text-[#f3f2ef] sm:p-9">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent opacity-30 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-accent opacity-10 blur-3xl"
            />
            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Still out there</p>
              <p className="font-display mt-2 text-5xl font-semibold tracking-tight sm:text-7xl">
                {formatCurrency(data.stats.totalOwed)}
              </p>
              <p className="mt-2 text-sm text-white/60">
                {allSettled ? (
                  "everyone's paid up"
                ) : (
                  <>
                    across {data.stats.peopleOwing} {data.stats.peopleOwing === 1 ? "person" : "people"} ·{" "}
                    {remindersSent} {remindersSent === 1 ? "reminder" : "reminders"} sent
                  </>
                )}
              </p>
              <p className="mt-5 max-w-xl text-lg font-medium leading-snug text-white">
                {tagline(data.stats.totalOwed, data.stats.peopleOwing, top, remindersSent)}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link
                  to="/add-expense"
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(228,87,46,0.8)] transition-transform hover:-translate-y-px"
                >
                  + Add Expense
                </Link>
                {!allSettled && (
                  <Link
                    to="/expenses"
                    className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  >
                    Chase them →
                  </Link>
                )}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="People owing"
              value={String(data.stats.peopleOwing)}
              hint={data.stats.peopleOwing > 0 ? "still on the hook" : "nobody on the hook"}
              to="/people"
            />
            <StatCard
              label="Reminders sent"
              value={String(remindersSent)}
              hint={remindersSent > 0 ? "on unpaid debts" : "nobody to chase"}
            />
          </div>

          <div className="rounded-2xl border border-border bg-card">
            <div className="flex items-baseline justify-between px-6 pt-5 pb-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Recent debts</h2>
              <Link to="/expenses" className="text-xs font-medium text-ink-soft hover:text-accent">
                See all →
              </Link>
            </div>
            {data.recent.length === 0 ? (
              <p className="px-6 pb-8 pt-4 text-center text-sm text-ink-soft">
                No expenses yet. Somebody definitely owes you for something.
              </p>
            ) : (
              <ul className="divide-y divide-border px-3 pb-3">
                {data.recent.map((debt) => {
                  const personName = debt.personName ?? "Unknown";
                  const row = (
                    <>
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                          debt.status === "PAID" ? "bg-ink/[0.06] text-ink-soft" : "bg-accent/15 text-accent"
                        }`}
                      >
                        {personName.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{personName}</p>
                        <p className="truncate text-xs text-ink-faint">
                          {debt.merchant ? `${debt.merchant} · ` : ""}
                          {formatDate(debt.createdAt)}
                        </p>
                      </div>
                      {/* Hidden on phones so names aren't cut short — the colored initial and the
                          struck-through paid amount still show status there. */}
                      <span className="hidden sm:inline-flex">
                        <StatusBadge status={debt.status} />
                      </span>
                      <span
                        className={`w-20 text-right sm:w-24 text-sm font-semibold ${
                          debt.status === "PAID" ? "text-ink-faint line-through decoration-1" : "text-ink"
                        }`}
                      >
                        {formatCurrency(debt.amount)}
                      </span>
                    </>
                  );
                  return (
                    <li key={debt.id}>
                      {debt.personId ? (
                        <Link
                          to={`/people/${debt.personId}`}
                          className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-ink/[0.03]"
                        >
                          {row}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-3 py-3">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
