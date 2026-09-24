import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/people", label: "People" },
  { to: "/expenses", label: "Expenses" },
];

export function Layout() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="leading-tight">
            <p className="font-display text-lg font-bold tracking-tight text-ink">UNHINGED</p>
            <p className="font-display text-lg font-bold tracking-tight text-accent -mt-1.5">DEBT COLLECTOR</p>
          </div>

          <nav className="flex flex-wrap items-center gap-0.5 rounded-full border border-border bg-ink/[0.03] p-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    isActive
                      ? "nav-active bg-card text-ink shadow-[0_1px_2px_rgba(22,23,27,0.08),0_2px_8px_-2px_rgba(22,23,27,0.12)]"
                      : "text-ink-soft hover:text-ink"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <NavLink
              to="/people?add=1"
              className="whitespace-nowrap rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-ink/30"
            >
              + Add People
            </NavLink>
            <NavLink
              to="/add-expense"
              className="whitespace-nowrap rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgba(228,87,46,0.6)] transition-transform hover:-translate-y-px"
            >
              + Add Expense
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `text-sm font-medium ${isActive ? "text-ink" : "text-ink-soft hover:text-ink"}`
              }
            >
              Settings
            </NavLink>
            <span className="text-sm text-ink-faint">{user?.name}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
