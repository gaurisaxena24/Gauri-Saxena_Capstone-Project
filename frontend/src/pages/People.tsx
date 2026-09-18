import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createPerson, listPeople, type PersonSummary } from "../api/client";
import { formatCurrency } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

export function People() {
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [relationship, setRelationship] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function load() {
    setError(null);
    listPeople()
      .then((res) => setPeople(res.people))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load people."));
  }

  useEffect(load, []);

  async function handleAdd() {
    setAddError(null);
    if (!name.trim() || !telegramUsername.trim()) {
      setAddError("Name and Telegram username are required.");
      return;
    }
    setSaving(true);
    try {
      await createPerson({
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
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Couldn't add this person.");
    } finally {
      setSaving(false);
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

      {people && people.length === 0 && !adding && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No people added yet.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {people?.map((person) => (
          <Link
            key={person.id}
            to={`/people/${person.id}`}
            className="flex items-center justify-between rounded-2xl border border-border bg-card p-5 transition-colors hover:border-ink/30"
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
        ))}
      </div>
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
