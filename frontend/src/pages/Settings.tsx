import { useSettings, type FontSize } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";

const FONT_SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
];

export function Settings() {
  const { theme, setTheme, fontSize, setFontSize } = useSettings();
  const { logout } = useAuth();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display mb-6 text-2xl font-bold text-ink">Settings</h1>

      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">Dark Mode</h2>
              <p className="mt-1 text-sm text-ink-faint">Applies across the entire app.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={theme === "dark"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                theme === "dark" ? "bg-ink" : "bg-ink/15"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  theme === "dark" ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-ink">Font Size</h2>
          <p className="mt-1 text-sm text-ink-faint">Make the app's text larger, everywhere.</p>
          <div className="mt-3 inline-flex rounded-full border border-border p-1">
            {FONT_SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFontSize(option.value)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  fontSize === option.value ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Account</h2>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-border px-5 py-2 text-sm font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)]"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
