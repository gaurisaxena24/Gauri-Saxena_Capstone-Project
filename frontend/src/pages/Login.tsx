import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";

export function Login() {
  const { loginWithUsername } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await loginWithUsername(username);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log in. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center leading-tight">
          <p className="font-display text-2xl font-bold tracking-tight text-ink">UNHINGED</p>
          <p className="font-display text-2xl font-bold tracking-tight text-accent -mt-2">
            DEBT COLLECTOR
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            Turns awkward money requests into messages people actually reply to.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-ink">
            Your Telegram username
          </label>
          <div className="flex items-center rounded-lg border border-border bg-paper px-3 focus-within:border-ink">
            <span className="text-ink-faint">@</span>
            <input
              id="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username"
              className="w-full bg-transparent py-2.5 pl-1 text-ink outline-none"
            />
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            This just identifies you locally — it's not a real login. Anyone with access to this
            computer can enter any username.
          </p>

          {error && (
            <div className="mt-4">
              <ErrorBanner message={error} />
            </div>
          )}

          <button
            type="submit"
            disabled={!username.trim() || submitting}
            className="mt-5 w-full rounded-lg bg-ink py-2.5 text-sm font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "Logging in…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
