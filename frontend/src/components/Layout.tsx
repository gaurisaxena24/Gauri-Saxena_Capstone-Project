import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/people", label: "People" },
  { to: "/expenses", label: "Expenses" },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-border bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="leading-tight">
            <p className="font-display text-lg font-bold tracking-tight text-ink">UNHINGED</p>
            <p className="font-display text-lg font-bold tracking-tight text-accent -mt-1.5">DEBT COLLECTOR</p>
          </div>

          <nav className="flex flex-wrap items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <NavLink
              to="/people?add=1"
              className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white"
            >
              + Add People
            </NavLink>
            <NavLink
              to="/add-expense"
              className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white"
            >
              + Add Expense
            </NavLink>
            <span className="text-sm text-ink-faint">@{user?.telegramUsername}</span>
            <button onClick={logout} className="text-sm font-medium text-ink-soft hover:text-ink">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
