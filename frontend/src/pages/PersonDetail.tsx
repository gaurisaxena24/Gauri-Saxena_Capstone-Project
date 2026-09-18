import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPerson, updatePerson, type PersonDetail as PersonDetailData } from "../api/client";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";

export function PersonDetail() {
  const { id } = useParams();
  const [person, setPerson] = useState<PersonDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState({ name: "", relationship: "", notes: "", phoneNumber: "" });
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

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
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this person."));
  }

  useEffect(load, [id]);

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
              @{person.telegramUsername} · {person.relationship ?? "no relationship set"}
              {person.phoneNumber && <> · {person.phoneNumber}</>}
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
            <Field label="Notes" value={editFields.notes} onChange={(v) => setEditFields({ ...editFields, notes: v })} />
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
                <span className="font-medium text-[var(--color-success)]">Verified — @{person.telegramUsername} can be sent to</span>
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
            <Link
              key={debt.id}
              to={`/debts/${debt.id}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 hover:border-ink/30"
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
          ))}
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
