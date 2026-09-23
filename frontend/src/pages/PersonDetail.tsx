import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getPerson,
  removePerson,
  updatePerson,
  type PersonDebtSummary,
  type PersonDetail as PersonDetailData,
} from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";
import { GmailSyncControl } from "../components/GmailSync";

export function PersonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [person, setPerson] = useState<PersonDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState({
    name: "",
    relationship: "",
    notes: "",
    phoneNumber: "",
    keepFormal: false,
  });
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState(false);

  function load() {
    setError(null);
    getPerson(Number(id))
      .then((data) => {
        setPerson(data);
        setEditFields({
          name: data.name,
          relationship: data.relationship ?? "",
          notes: data.notes ?? "",
          phoneNumber: data.phoneNumber ?? "",
          keepFormal: data.keepFormal,
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this person."));
  }

  useEffect(load, [id]);

  /** Updates only this one debt's row — never refetches the whole person. */
  function updatePersonDebt(debtId: number, patch: Partial<PersonDebtSummary>) {
    setPerson((prev) =>
      prev ? { ...prev, debts: prev.debts.map((d) => (d.id === debtId ? { ...d, ...patch } : d)) } : prev
    );
  }

  async function saveEdits() {
    if (!person) return;
    setSaving(true);
    try {
      const updated = await updatePerson(person.id, editFields);
      setPerson(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function checkVerification() {
    setChecking(true);
    try {
      load();
    } finally {
      setChecking(false);
    }
  }

  async function handleRemove() {
    if (!person) return;
    if (person.debts.length > 0) {
      window.alert(
        `${person.name} still has ${person.debts.length} debt(s). Remove ${
          person.debts.length === 1 ? "it" : "them"
        } first (below), then you can delete this person.`
      );
      return;
    }
    const label = person.telegramUsername ? `@${person.telegramUsername}` : "no Telegram username";
    if (
      !window.confirm(
        `Remove ${person.name} (${label})?\n\nThis does not affect any of their expenses.`
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      await removePerson(person.id);
      navigate("/people");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove this person.");
      setRemoving(false);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!person) return null;

  return (
    <div>
      <Link to="/people" className="text-sm text-ink-soft hover:text-ink">
        ← All people
      </Link>

      <div className="mt-3 mb-6 flex items-start justify-between">
        {!editing ? (
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">{person.name}</h1>
            <p className="text-sm text-ink-faint">
              {person.telegramUsername ? `@${person.telegramUsername}` : "No Telegram username"} ·{" "}
              {person.relationship ?? "no relationship set"}
              {person.phoneNumber && <> · {person.phoneNumber}</>}
              {person.keepFormal && <> · restrained/formal reminders</>}
            </p>
            {person.notes && <p className="mt-2 text-sm text-ink-soft">{person.notes}</p>}
          </div>
        ) : (
          <div className="w-full max-w-sm space-y-3">
            <Field label="Name" value={editFields.name} onChange={(v) => setEditFields({ ...editFields, name: v })} />
            <Field
              label="Relationship"
              value={editFields.relationship}
              onChange={(v) => setEditFields({ ...editFields, relationship: v })}
            />
            <Field
              label="Phone number"
              value={editFields.phoneNumber}
              onChange={(v) => setEditFields({ ...editFields, phoneNumber: v })}
            />
            <Field
              label="Describe them (shapes reminder tone)"
              value={editFields.notes}
              onChange={(v) => setEditFields({ ...editFields, notes: v })}
            />
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={editFields.keepFormal}
                onChange={(e) => setEditFields({ ...editFields, keepFormal: e.target.checked })}
              />
              <span>
                Keep reminders restrained/formal for this person
                <span className="block text-xs text-ink-faint">
                  Overrides relationship-based auto-detection (e.g. "professor", "boss") — turn this on to force
                  it, regardless of what Relationship says. Automatic follow-ups will never escalate to a blunt
                  or angry tone for this person.
                </span>
              </span>
            </label>
            <div className="flex gap-2">
              <button onClick={saveEdits} disabled={saving} className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper">
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="text-sm font-medium text-ink-soft hover:text-ink">
                Cancel
              </button>
            </div>
          </div>
        )}
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-sm font-medium text-ink-soft hover:text-ink">
            Edit
          </button>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Telegram verification</h2>
            <p className="mt-1 text-sm">
              {person.telegramVerified ? (
                <span className="font-medium text-[var(--color-success)]">
                  Verified — {person.telegramUsername ? `@${person.telegramUsername}` : person.name} can be sent to
                </span>
              ) : (
                <span className="text-ink-soft">Not verified yet</span>
              )}
            </p>
          </div>
          <button
            onClick={checkVerification}
            disabled={checking}
            className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-ink hover:border-ink/40 disabled:opacity-40"
          >
            {checking ? "Checking…" : "Check status"}
          </button>
        </div>
        {!person.telegramVerified && (
          <div className="mt-3 space-y-2 text-xs text-ink-faint">
            <p>
              A phone number or typed username alone doesn't prove this is really their account — and if they
              haven't set a public Telegram username, the bot can't identify them from a message alone either.
            </p>
            <p>
              Send {person.name} this code and ask them to message it to the bot (works whether or not they have a
              username):
            </p>
            <p className="rounded-lg bg-ink/5 px-3 py-2 font-mono text-sm tracking-widest text-ink">
              {person.verificationCode}
            </p>
          </div>
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">Debt history</h2>

      {person.debts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No debts recorded for {person.name} yet.
        </div>
      ) : (
        <div className="space-y-3">
          {person.debts.map((debt) => (
            <PersonDebtRow
              key={debt.id}
              debt={debt}
              onSynced={(summary) => updatePersonDebt(debt.id, { gmailSync: summary })}
              onGmailMarkedPaid={(paidAt) => updatePersonDebt(debt.id, { status: "PAID", paidAt })}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleRemove}
        disabled={removing}
        className="mt-6 rounded-full border border-border px-5 py-2 text-sm font-medium text-ink-soft hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
      >
        {removing ? "Removing…" : "Remove person"}
      </button>
    </div>
  );
}

/**
 * One row in this person's debt history. The whole row used to be a single <Link> to the parent
 * expense — split here into the Link (name/date/amount/status, still navigates on click) plus a
 * separate Sync control underneath, since an interactive Sync button can't be nested inside an
 * anchor. Only rendered as its own component (rather than inline in a .map) because GmailSyncControl
 * needs its own per-row state (in-flight guard, expanded/dismissed) — hooks can't live inside a
 * .map callback.
 */
function PersonDebtRow({
  debt,
  onSynced,
  onGmailMarkedPaid,
}: {
  debt: PersonDebtSummary;
  onSynced: (summary: NonNullable<PersonDebtSummary["gmailSync"]>) => void;
  onGmailMarkedPaid: (paidAt: string | null) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Link
        to={`/expenses/${debt.expenseId}`}
        className="flex items-center justify-between gap-3 hover:opacity-80"
      >
        <div>
          <p className="font-medium text-ink">{debt.merchant ?? debt.category ?? "Expense"}</p>
          <p className="text-sm text-ink-faint">{formatDate(debt.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={debt.status} />
          <span className="w-20 text-right font-medium text-ink">{formatCurrency(debt.amount)}</span>
        </div>
      </Link>
      {debt.status === "UNPAID" && (
        <div className="mt-2">
          <GmailSyncControl
            debtId={debt.id}
            gmailSync={debt.gmailSync}
            onSynced={onSynced}
            onMarkedPaid={onGmailMarkedPaid}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-paper px-3 py-2 text-ink outline-none focus:border-ink"
      />
    </label>
  );
}
