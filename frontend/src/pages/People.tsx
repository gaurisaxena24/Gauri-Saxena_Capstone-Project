import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createPerson,
  getHealth,
  getPerson,
  listPeople,
  removePerson,
  type PersonDetail,
  type PersonSummary,
} from "../api/client";
import { formatCurrency } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

/** Builds the exact text the "Copy instructions" button copies, from the real bot username and
 * this person's real code — never a placeholder, never another person's code. */
function buildInstructionsText(botUsername: string | null, code: string): string {
  const botLabel = botUsername ? `@${botUsername}` : "the bot";
  return `Hey! I'm adding you to my expense thing. Open Telegram and search ${botLabel}, press Start, then send the code ${code} to the bot. Once you've done that, let me know and I'll check the verification here.`;
}

export function People() {
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [relationship, setRelationship] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Telegram "how to connect" panel state — one open panel at a time, keyed by person id.
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [connectId, setConnectId] = useState<number | null>(null);
  const [connectDetail, setConnectDetail] = useState<PersonDetail | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<"code" | "instructions" | null>(null);

  function load() {
    setError(null);
    listPeople()
      .then((res) => setPeople(res.people))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load people."));
  }

  useEffect(load, []);

  useEffect(() => {
    getHealth()
      .then((health) => setBotUsername(health.botUsername))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => setCopyFeedback(null), 2000);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  function closeConnectPanel() {
    setConnectId(null);
    setConnectDetail(null);
    setConnectError(null);
  }

  function openConnectPanel(id: number, knownDetail?: PersonDetail) {
    setConnectId(id);
    setConnectError(null);
    // Defaults to hidden — a verified person's panel opens collapsed (they just show "Telegram
    // connected ✓" plus a toggle). An unverified person always sees the full steps regardless of
    // this flag, since ConnectPanel's `showSteps` is `!verified || showInstructions`.
    setShowInstructions(false);
    if (knownDetail) {
      setConnectDetail(knownDetail);
      return;
    }
    setConnectDetail(null);
    setConnectLoading(true);
    getPerson(id)
      .then(setConnectDetail)
      .catch((err) => setConnectError(err instanceof Error ? err.message : "Couldn't load connection details."))
      .finally(() => setConnectLoading(false));
  }

  function toggleConnectPanel(id: number) {
    if (connectId === id) {
      closeConnectPanel();
    } else {
      openConnectPanel(id);
    }
  }

  async function refreshConnectStatus() {
    if (!connectId) return;
    setConnectLoading(true);
    setConnectError(null);
    try {
      const detail = await getPerson(connectId);
      setConnectDetail(detail);
      setPeople((prev) =>
        prev?.map((p) => (p.id === detail.id ? { ...p, telegramVerified: detail.telegramVerified } : p)) ?? prev
      );
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Couldn't check status.");
    } finally {
      setConnectLoading(false);
    }
  }

  async function copyText(text: string, kind: "code" | "instructions") {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(kind);
    } catch {
      setConnectError("Couldn't copy to clipboard. You can select and copy the text manually.");
    }
  }

  async function handleAdd() {
    setAddError(null);
    if (!name.trim() || !telegramUsername.trim()) {
      setAddError("Name and Telegram username are required.");
      return;
    }
    setSaving(true);
    try {
      const created = await createPerson({
        name: name.trim(),
        telegramUsername: telegramUsername.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        relationship: relationship.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setName("");
      setTelegramUsername("");
      setPhoneNumber("");
      setRelationship("");
      setNotes("");
      setAdding(false);
      load();
      // Show "how to connect" right away — no navigating away or hunting for it.
      openConnectPanel(created.id, created);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Couldn't add this person.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(person: PersonSummary) {
    if (
      !window.confirm(
        `Remove ${person.name} (@${person.telegramUsername})?\n\nThis does not affect any of their expenses. If a debt is still drafted for them, removal will be blocked until that debt is removed first.`
      )
    ) {
      return;
    }
    setRemoveError(null);
    setRemovingId(person.id);
    try {
      await removePerson(person.id);
      setPeople((prev) => prev?.filter((p) => p.id !== person.id) ?? prev);
      if (connectId === person.id) closeConnectPanel();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Couldn't remove this person.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">People</h1>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper"
        >
          {adding ? "Cancel" : "+ Add Person"}
        </button>
      </div>

      {adding && (
        <div className="mb-6 space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" value={name} onChange={setName} />
            <Field label="Telegram username" value={telegramUsername} onChange={setTelegramUsername} placeholder="rahul123" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Phone number" value={phoneNumber} onChange={setPhoneNumber} placeholder="Optional" />
            <Field label="Relationship" value={relationship} onChange={setRelationship} placeholder="Friend, roommate…" />
          </div>
          <Field
            label="Describe them (shapes the reminder's tone)"
            value={notes}
            onChange={setNotes}
            placeholder="e.g. laid-back, jokes around a lot, always forgets to pay but means well"
          />
          {addError && <ErrorBanner message={addError} />}
          <button
            onClick={handleAdd}
            disabled={saving}
            className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save person"}
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {removeError && <div className="mb-4"><ErrorBanner message={removeError} /></div>}

      {people && people.length === 0 && !adding && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No people added yet.
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        {people?.map((person) => {
          const isOpen = connectId === person.id;
          return (
            <div key={person.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <Link
                  to={`/people/${person.id}`}
                  className="flex flex-1 items-center justify-between gap-3 transition-colors hover:opacity-80"
                >
                  <div>
                    <p className="font-medium text-ink">{person.name}</p>
                    <p className="text-sm text-ink-faint">
                      @{person.telegramUsername} · {person.relationship ?? "—"}
                    </p>
                    <p className="mt-1 text-xs">
                      {person.telegramVerified ? (
                        <span className="text-[var(--color-success)]">Telegram verified</span>
                      ) : (
                        <span className="text-ink-faint">Not verified yet</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg font-bold text-ink">{formatCurrency(person.totalOwed)}</p>
                    <p className="text-xs text-ink-faint">currently owed</p>
                  </div>
                </Link>
                <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleConnectPanel(person.id)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink/40 hover:text-ink"
                  >
                    {isOpen ? "Hide connect info" : "How to connect"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(person)}
                    disabled={removingId === person.id}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
                  >
                    {removingId === person.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </div>

              {isOpen && (
                <ConnectPanel
                  detail={connectId === person.id ? connectDetail : null}
                  loading={connectLoading}
                  error={connectError}
                  botUsername={botUsername}
                  showInstructions={showInstructions}
                  onToggleInstructions={() => setShowInstructions((v) => !v)}
                  onCheckStatus={refreshConnectStatus}
                  onCopyCode={(code) => copyText(code, "code")}
                  onCopyInstructions={(text) => copyText(text, "instructions")}
                  copyFeedback={copyFeedback}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConnectPanel({
  detail,
  loading,
  error,
  botUsername,
  showInstructions,
  onToggleInstructions,
  onCheckStatus,
  onCopyCode,
  onCopyInstructions,
  copyFeedback,
}: {
  detail: PersonDetail | null;
  loading: boolean;
  error: string | null;
  botUsername: string | null;
  showInstructions: boolean;
  onToggleInstructions: () => void;
  onCheckStatus: () => void;
  onCopyCode: (code: string) => void;
  onCopyInstructions: (text: string) => void;
  copyFeedback: "code" | "instructions" | null;
}) {
  if (loading && !detail) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-paper p-4 text-sm text-ink-faint">
        Loading connection details…
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="mt-4">
        <ErrorBanner message={error} onRetry={onCheckStatus} />
      </div>
    );
  }

  if (!detail) return null;

  const verified = detail.telegramVerified;
  const instructionsText = buildInstructionsText(botUsername, detail.verificationCode);
  const botLabel = botUsername ? `@${botUsername}` : null;
  const botLink = botUsername ? `https://t.me/${botUsername}` : null;
  const showSteps = !verified || showInstructions;

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-border bg-paper p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">
          {verified ? (
            <span className="text-[var(--color-success)]">Telegram connected ✓</span>
          ) : (
            "Telegram not connected"
          )}
        </p>
        <button
          type="button"
          onClick={onCheckStatus}
          disabled={loading}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-ink-soft hover:border-ink/40 hover:text-ink disabled:opacity-40"
        >
          {loading ? "Checking…" : "Check status"}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {verified && (
        <button
          type="button"
          onClick={onToggleInstructions}
          className="text-xs font-medium text-ink-soft underline decoration-dotted underline-offset-2 hover:no-underline"
        >
          {showInstructions ? "Hide instructions" : "Show instructions again"}
        </button>
      )}

      {showSteps && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {detail.name}'s code
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-base tracking-widest text-ink">
                {detail.verificationCode}
              </code>
              <button
                type="button"
                onClick={() => onCopyCode(detail.verificationCode)}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink/40 hover:text-ink"
              >
                {copyFeedback === "code" ? "Copied" : "Copy code"}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">What you do</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              <li>Add {detail.name}'s name and relationship, and save (already done).</li>
              <li>Send them the code or the instructions below, any way you like.</li>
              <li>Once they say they've sent the code, come back here and click "Check status".</li>
            </ol>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">What they do</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              <li>Open Telegram.</li>
              <li>
                {botLabel
                  ? `Search for ${botLabel} (or open it directly below) and press Start.`
                  : "Search for this app's Telegram bot and press Start. (Its username isn't available right now; check that Telegram is configured.)"}
              </li>
              <li>Send the code {detail.verificationCode} to the bot.</li>
              <li>Wait for the bot to confirm they're connected.</li>
            </ol>
          </div>

          {botLink && (
            <a
              href={botLink}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink/40 hover:text-ink"
            >
              Open bot in Telegram
            </a>
          )}

          <div>
            <button
              type="button"
              onClick={() => onCopyInstructions(instructionsText)}
              className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper"
            >
              {copyFeedback === "instructions" ? "Copied" : "Copy instructions"}
            </button>
          </div>

          <p className="text-xs text-ink-faint">
            This code works whether or not {detail.name} has a public Telegram username.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-paper px-3 py-2 text-ink outline-none focus:border-ink"
      />
    </label>
  );
}
