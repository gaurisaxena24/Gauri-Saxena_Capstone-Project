import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSettings, type FontSize } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";
import {
  disconnectGmail,
  getGmailStatus,
  getGoogleApiKeyStatus,
  getHealth,
  saveGoogleApiKey,
  verifyGmail,
  type GmailStatus,
  type GoogleApiKeyStatus,
} from "../api/client";
import { formatDateTime } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

const FONT_SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
];

export function Settings() {
  const { theme, setTheme, fontSize, setFontSize } = useSettings();
  const { logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [gmailConfigured, setGmailConfigured] = useState(true);
  const [gmailBanner, setGmailBanner] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  function loadGmailStatus() {
    getGmailStatus()
      .then(setGmail)
      .catch((err) => setGmailError(err instanceof Error ? err.message : "Couldn't load Gmail status."));
  }

  useEffect(loadGmailStatus, []);
  useEffect(() => {
    getHealth()
      .then((health) => setGmailConfigured(health.gmailConfigured))
      .catch(() => {});
  }, []);

  // The backend redirects back here with ?gmail=connected|error after the Google OAuth round
  // trip — same fix as People.tsx's ?add=1 bug: re-check on every navigation (a useEffect keyed
  // on searchParams), not just once at mount via a useState initializer, since a redirect back to
  // an already-mounted route doesn't remount the component.
  useEffect(() => {
    const result = searchParams.get("gmail");
    if (!result) return;
    setGmailBanner(result === "connected" ? "Gmail connected." : null);
    setGmailError(result === "error" ? "Couldn't connect Gmail. Please try again." : null);
    loadGmailStatus();
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("gmail");
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  async function handleVerify() {
    setVerifying(true);
    setGmailError(null);
    setGmailBanner(null);
    try {
      const result = await verifyGmail();
      if (result.verified) {
        setGmailBanner("Gmail connection verified.");
        loadGmailStatus();
      } else if (result.reason === "reconnect_required") {
        setGmailError("Your Gmail connection has expired. Reconnect below.");
      } else {
        setGmailError("Could not verify the connection right now. Please try again.");
      }
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : "Couldn't verify Gmail.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setGmailError(null);
    setGmailBanner(null);
    try {
      await disconnectGmail();
      setGmail({ connected: false });
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : "Couldn't disconnect Gmail.");
    } finally {
      setDisconnecting(false);
    }
  }

  const [apiKeyStatus, setApiKeyStatus] = useState<GoogleApiKeyStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyBanner, setApiKeyBanner] = useState<string | null>(null);

  useEffect(() => {
    getGoogleApiKeyStatus()
      .then(setApiKeyStatus)
      .catch((err) => setApiKeyError(err instanceof Error ? err.message : "Couldn't load key status."));
  }, []);

  async function submitApiKey(value: string) {
    setApiKeySaving(true);
    setApiKeyError(null);
    setApiKeyBanner(null);
    try {
      const result = await saveGoogleApiKey(value);
      setApiKeyStatus(result);
      setApiKeyInput("");
      setApiKeyBanner(result.configured ? "Key saved." : "Key removed.");
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "Couldn't save the key.");
    } finally {
      setApiKeySaving(false);
    }
  }

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
                className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-black shadow transition-transform ${
                  theme === "dark" ? "translate-x-5" : "translate-x-0"
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
          <h2 className="text-sm font-semibold text-ink">Gmail</h2>
          <p className="mt-1 text-sm text-ink-faint">
            Connect your Gmail and the app checks it every few minutes for payment emails (like a UPI "money
            received" message). If one matches something someone owes you, that debt is automatically marked
            Paid and stops getting reminders — you don't have to do anything yourself.
          </p>

          {gmailBanner && <p className="mt-1 text-sm text-[var(--color-success)]">{gmailBanner}</p>}
          {gmailError && (
            <div className="mt-2">
              <ErrorBanner message={gmailError} />
            </div>
          )}

          {!gmailConfigured ? (
            <p className="mt-1 text-sm text-ink-faint">Gmail isn't configured on the server yet.</p>
          ) : gmail?.connected ? (
            <>
              <p className="mt-1 text-sm text-ink-soft">
                Connected as <span className="font-medium text-ink">{gmail.emailAddress}</span>
              </p>
              {gmail.connectedAt && (
                <p className="mt-0.5 text-xs text-ink-faint">Connected {formatDateTime(gmail.connectedAt)}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={verifying}
                  className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-ink-soft hover:border-ink/40 hover:text-ink disabled:opacity-40"
                >
                  {verifying ? "Checking…" : "Test / Verify"}
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-faint">Not connected.</p>
              <button
                type="button"
                onClick={() => {
                  window.location.href = "/api/gmail/connect";
                }}
                className="mt-3 rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper"
              >
                Connect Gmail
              </button>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-ink">Google API Key (Optional)</h2>
          <p className="mt-1 text-sm text-ink-faint">
            Not required for Gmail or anything else in the app right now — available if you want to add your own.
          </p>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-block text-xs font-medium text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            How to find your key ↗
          </a>

          {apiKeyBanner && <p className="mt-2 text-sm text-[var(--color-success)]">{apiKeyBanner}</p>}
          {apiKeyError && (
            <div className="mt-2">
              <ErrorBanner message={apiKeyError} />
            </div>
          )}

          {apiKeyStatus?.encryptionConfigured === false ? (
            <p className="mt-2 text-sm text-ink-faint">Saving a key isn't available on the server yet.</p>
          ) : (
            <>
              {apiKeyStatus?.configured && (
                <p className="mt-2 text-sm text-ink-soft">
                  Saved: <span className="font-mono text-ink">{apiKeyStatus.maskedKey}</span>
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={apiKeyStatus?.configured ? "Replace key" : "AIzaSyD-XXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                />
                <button
                  type="button"
                  onClick={() => void submitApiKey(apiKeyInput.trim())}
                  disabled={apiKeySaving || !apiKeyInput.trim()}
                  className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper disabled:opacity-40"
                >
                  {apiKeySaving ? "Saving…" : "Save"}
                </button>
                {apiKeyStatus?.configured && (
                  <button
                    type="button"
                    onClick={() => void submitApiKey("")}
                    disabled={apiKeySaving}
                    className="rounded-full border border-border px-4 py-2 text-xs font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">
                Looks like <span className="font-mono">AIzaSyD-...</span> — a 39-character key from your Google Cloud project's Credentials page.
              </p>
            </>
          )}
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
