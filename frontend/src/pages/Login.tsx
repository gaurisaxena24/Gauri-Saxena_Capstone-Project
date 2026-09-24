import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";

export function Login() {
  const { login, recoverAccount } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState("");
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [recoverSubmitting, setRecoverSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const authed = await login(name);
      // Handed off via sessionStorage, not router state — the declarative redirect on the /login
      // route (see App.tsx: user becomes truthy -> <Navigate to="/dashboard" replace/>) fires as
      // soon as `login()` sets the user, racing this very call and replacing history without any
      // state we'd attach here. Dashboard reads and clears this on mount instead.
      try {
        sessionStorage.setItem("udc.newRecoveryCode", authed.recoveryCode);
      } catch {
        // per-viewer convenience only — worst case the one-time banner just doesn't show
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log in. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecoverSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setRecoverSubmitting(true);
    setRecoverError(null);
    try {
      await recoverAccount(code);
      navigate("/dashboard");
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : "Couldn't sign in. Try again.");
    } finally {
      setRecoverSubmitting(false);
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

        {!recovering ? (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-ink">
              What should we call you?
            </label>
            <input
              id="name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-border bg-paper px-3 py-2.5 text-ink outline-none focus:border-ink"
            />
            <p className="mt-2 text-xs text-ink-faint">
              We'll use this to personalize your experience — no password needed.
            </p>

            {error && (
              <div className="mt-4">
                <ErrorBanner message={error} />
              </div>
            )}

            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="mt-5 w-full rounded-lg bg-ink py-2.5 text-sm font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? "Continuing…" : "Continue"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRecoverSubmit} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-ink">
              Your recovery code
            </label>
            <input
              id="code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="AB3D-9F2K"
              className="w-full rounded-lg border border-border bg-paper px-3 py-2.5 text-ink outline-none focus:border-ink"
            />
            <p className="mt-2 text-xs text-ink-faint">
              The code you saved when you first signed in — find it again in Settings once you're back in.
            </p>

            {recoverError && (
              <div className="mt-4">
                <ErrorBanner message={recoverError} />
              </div>
            )}

            <button
              type="submit"
              disabled={!code.trim() || recoverSubmitting}
              className="mt-5 w-full rounded-lg bg-ink py-2.5 text-sm font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {recoverSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setRecovering((r) => !r);
            setError(null);
            setRecoverError(null);
          }}
          className="mt-4 w-full text-center text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline"
        >
          {recovering ? "New here? Enter your name instead" : "Already have an account? Sign in with a recovery code"}
        </button>
      </div>
    </div>
  );
}
