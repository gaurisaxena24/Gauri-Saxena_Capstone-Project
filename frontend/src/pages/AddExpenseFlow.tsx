import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  createDebt,
  createManualExpense,
  createPerson,
  editMessage,
  extractExpenseFromImage,
  generateMessage,
  listPeople,
  sendDebtViaTelegram,
  updateExpense,
  type DebtSummary,
  type Expense,
  type PersonSummary,
  type ReminderContext,
  type ShareMode,
} from "../api/client";
import { formatCurrency } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";
import { ToneBadge } from "../components/ToneBadge";

type Step = "choice" | "upload" | "manual" | "extracted" | "person" | "amount" | "message" | "done";

const TONES = ["Casual", "Funny", "Passive-Aggressive", "Unhinged"] as const;
const PAYMENT_METHODS = ["UPI", "Google Pay", "Cash", "Card", "Bank Transfer", "Other"];
const DESIRED_ACTIONS = [
  "Send their share",
  "Pay the full amount",
  "Send it today",
  "Tell me when they'll pay",
  "Other",
];

function StepIndicator({ current }: { current: Step }) {
  const order: Step[] = ["choice", "person", "amount", "message"];
  const labels: Record<string, string> = { choice: "Expense", person: "Person", amount: "Amount", message: "Reminder" };
  const effective = current === "upload" || current === "manual" || current === "extracted" ? "choice" : current;
  const currentIndex = order.indexOf(effective);
  return (
    <div className="mb-8 flex items-center gap-2">
      {order.map((key, i) => (
        <div key={key} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              i <= currentIndex ? "bg-ink text-paper" : "bg-ink/10 text-ink-faint"
            }`}
          >
            {i + 1}
          </div>
          <span className={`text-sm ${i <= currentIndex ? "text-ink" : "text-ink-faint"}`}>{labels[key]}</span>
          {i < order.length - 1 && <div className="mx-1 h-px w-6 bg-border" />}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-paper px-3 py-2 text-ink outline-none focus:border-ink"
      />
    </label>
  );
}

export function AddExpenseFlow() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("choice");

  // Manual entry
  const [manualAmount, setManualAmount] = useState("");
  const [manualCurrency, setManualCurrency] = useState("INR");
  const [manualDate, setManualDate] = useState("");
  const [manualMerchant, setManualMerchant] = useState("");
  const [manualCategory, setManualCategory] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualPaymentMethod, setManualPaymentMethod] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [savingManual, setSavingManual] = useState(false);

  // Image upload
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<{ message: string; aiNotConfigured: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);

  const [expense, setExpense] = useState<Expense | null>(null);

  // Person tagging
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [addingNewPerson, setAddingNewPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonUsername, setNewPersonUsername] = useState("");
  const [newPersonRelationship, setNewPersonRelationship] = useState("");
  const [newPersonPhone, setNewPersonPhone] = useState("");
  const [newPersonDescription, setNewPersonDescription] = useState("");
  const [personError, setPersonError] = useState<string | null>(null);
  const [savingPerson, setSavingPerson] = useState(false);

  // Amount
  const [mode, setMode] = useState<ShareMode | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [confirmingAmount, setConfirmingAmount] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);

  // Optional context for the AI message
  const [additionalContext, setAdditionalContext] = useState("");
  const [desiredActionChoice, setDesiredActionChoice] = useState("");
  const [customDesiredAction, setCustomDesiredAction] = useState("");

  // Debt + message
  const [debt, setDebt] = useState<(DebtSummary & { context?: ReminderContext }) | null>(null);
  const [generating, setGenerating] = useState(false);
  const [messageError, setMessageError] = useState<{ message: string; notVerified: boolean } | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ note: string } | null>(null);

  useEffect(() => {
    if (step === "person") {
      listPeople()
        .then((res) => setPeople(res.people))
        .catch(() => setPeople([]));
    }
  }, [step]);

  async function handleFile(file: File) {
    lastFileRef.current = file;
    setExtractError(null);
    setPreviewUrl(URL.createObjectURL(file));
    setExtracting(true);
    try {
      const result = await extractExpenseFromImage(file);
      setExpense(result);
      setStep("extracted");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't read that image. Try another photo.";
      setExtractError({ message, aiNotConfigured: err instanceof ApiError && err.aiNotConfigured });
    } finally {
      setExtracting(false);
    }
  }

  function retryExtraction() {
    if (lastFileRef.current) handleFile(lastFileRef.current);
  }

  async function submitManualExpense() {
    setManualError(null);
    const amount = Number(manualAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setManualError("Enter a valid amount greater than 0.");
      return;
    }
    setSavingManual(true);
    try {
      const created = await createManualExpense({
        amount,
        currency: manualCurrency || undefined,
        date: manualDate || undefined,
        merchant: manualMerchant || undefined,
        category: manualCategory || undefined,
        description: manualDescription || undefined,
        paymentMethod: manualPaymentMethod || undefined,
        notes: manualNotes || undefined,
      });
      setExpense(created);
      setStep("person");
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Couldn't save this expense.");
    } finally {
      setSavingManual(false);
    }
  }

  async function saveExtractedEdits() {
    if (!expense) return;
    const updated = await updateExpense(expense.id, {
      merchant: expense.merchant,
      date: expense.date,
      total: expense.total,
      currency: expense.currency,
      tax: expense.tax,
      tip: expense.tip,
      category: expense.category,
    });
    setExpense(updated);
    setStep("person");
  }

  async function confirmPerson() {
    setPersonError(null);
    if (addingNewPerson) {
      if (!newPersonName.trim() || !newPersonUsername.trim()) {
        setPersonError("Name and Telegram username are required.");
        return;
      }
      setSavingPerson(true);
      try {
        const person = await createPerson({
          name: newPersonName.trim(),
          telegramUsername: newPersonUsername.trim(),
          relationship: newPersonRelationship.trim() || undefined,
          phoneNumber: newPersonPhone.trim() || undefined,
          notes: newPersonDescription.trim() || undefined,
        });
        setSelectedPersonId(person.id);
        setStep("amount");
      } catch (err) {
        setPersonError(err instanceof Error ? err.message : "Couldn't save that person.");
      } finally {
        setSavingPerson(false);
      }
      return;
    }

    if (!selectedPersonId) {
      setPersonError("Select someone first.");
      return;
    }
    setStep("amount");
  }

  const computedAmount =
    mode === "FULL" ? (expense?.total ?? 0) : mode === "HALF" ? (expense?.total ?? 0) / 2 : mode === "CUSTOM" ? Number(customAmount) : null;

  const customAmountInvalid = mode === "CUSTOM" && (!customAmount || !Number.isFinite(Number(customAmount)) || Number(customAmount) <= 0);

  async function confirmAmount() {
    if (!expense || !selectedPersonId || !mode) return;
    if (customAmountInvalid) {
      setAmountError("Enter a valid amount greater than 0.");
      return;
    }
    setAmountError(null);
    setConfirmingAmount(true);
    const resolvedDesiredAction =
      desiredActionChoice === "Other" ? customDesiredAction.trim() : desiredActionChoice;
    try {
      const created = await createDebt({
        expenseId: expense.id,
        personId: selectedPersonId,
        mode,
        customAmount: mode === "CUSTOM" ? Number(customAmount) : undefined,
        additionalContext: additionalContext.trim() || undefined,
        desiredAction: resolvedDesiredAction || undefined,
      });
      setDebt(created);
      setStep("message");
      await runGenerate(created.id, undefined, false);
    } catch (err) {
      setAmountError(err instanceof Error ? err.message : "Couldn't confirm this debt.");
    } finally {
      setConfirmingAmount(false);
    }
  }

  async function runGenerate(debtId: number, tone: string | undefined, regenerate: boolean) {
    setGenerating(true);
    setMessageError(null);
    try {
      const result = await generateMessage(debtId, { tone, regenerate });
      setDebt((prev) => (prev ? { ...prev, message: result.message, tone: result.tone } : prev));
      setReasoning(result.reasoning || null);
      setDraftText(result.message ?? "");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Message generation failed. Try again.";
      setMessageError({ message, notVerified: false });
    } finally {
      setGenerating(false);
    }
  }

  async function saveEditedMessage() {
    if (!debt) return;
    try {
      const updated = await editMessage(debt.id, draftText);
      setDebt(updated);
      setEditingMessage(false);
    } catch (err) {
      setMessageError({ message: err instanceof Error ? err.message : "Couldn't save your edit.", notVerified: false });
    }
  }

  async function handleSend() {
    if (!debt) return;
    setSending(true);
    setMessageError(null);
    try {
      const result = await sendDebtViaTelegram(debt.id);
      setSendResult(result);
      setStep("done");
    } catch (err) {
      const notVerified = err instanceof ApiError && err.notVerified;
      setMessageError({ message: err instanceof Error ? err.message : "Couldn't send via Telegram.", notVerified });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <StepIndicator current={step} />

      {step === "choice" && (
        <div>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">Add expense</h1>
          <p className="mb-6 text-sm text-ink-soft">How do you want to add it?</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <button
              onClick={() => setStep("upload")}
              className="rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-ink/30"
            >
              <p className="font-display text-lg font-bold text-ink">Upload screenshot / receipt</p>
              <p className="mt-1 text-sm text-ink-soft">
                A restaurant bill, Google Pay/UPI screenshot, receipt, or any payment confirmation.
              </p>
            </button>
            <button
              onClick={() => setStep("manual")}
              className="rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-ink/30"
            >
              <p className="font-display text-lg font-bold text-ink">Enter manually</p>
              <p className="mt-1 text-sm text-ink-soft">
                Already know the details? Type them in directly — no AI needed.
              </p>
            </button>
          </div>
        </div>
      )}

      {step === "upload" && (
        <div>
          <button onClick={() => setStep("choice")} className="mb-4 text-sm text-ink-soft hover:text-ink">
            ← Back
          </button>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">Upload a screenshot or receipt</h1>
          <p className="mb-6 text-sm text-ink-soft">
            Bills, Google Pay/UPI screenshots, receipts — we'll read whatever's in it.
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-accent bg-accent-soft" : "border-border bg-card hover:border-ink/30"
            }`}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="Upload preview" className="max-h-56 rounded-lg object-contain" />
            ) : (
              <>
                <p className="font-medium text-ink">Drag & drop an image here</p>
                <p className="mt-1 text-sm text-ink-faint">or click to browse</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {extracting && <p className="mt-4 text-sm text-ink-soft">Reading it…</p>}

          {extractError && (
            <div className="mt-4 space-y-2">
              <ErrorBanner message={extractError.message} onRetry={retryExtraction} />
              {extractError.aiNotConfigured && (
                <p className="text-xs text-ink-faint">
                  Add <code className="rounded bg-ink/5 px-1">GROQ_API_KEY</code> to the project's{" "}
                  <code className="rounded bg-ink/5 px-1">.env</code> file, then restart the server.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {step === "manual" && (
        <div>
          <button onClick={() => setStep("choice")} className="mb-4 text-sm text-ink-soft hover:text-ink">
            ← Back
          </button>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">Enter expense manually</h1>
          <p className="mb-6 text-sm text-ink-soft">No screenshot needed.</p>

          <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Amount" value={manualAmount} onChange={setManualAmount} type="number" placeholder="850" />
              <Field label="Currency" value={manualCurrency} onChange={setManualCurrency} placeholder="INR" />
            </div>
            <Field label="Date" value={manualDate} onChange={setManualDate} type="date" />
            <Field label="Merchant / Paid to" value={manualMerchant} onChange={setManualMerchant} placeholder="Restaurant, roommate, etc." />
            <Field label="Category" value={manualCategory} onChange={setManualCategory} placeholder="Food, rent, travel…" />
            <Field label="Description / Reason" value={manualDescription} onChange={setManualDescription} placeholder="Birthday dinner" />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Payment method</span>
              <select
                value={manualPaymentMethod}
                onChange={(e) => setManualPaymentMethod(e.target.value)}
                className="w-full rounded-lg border border-border bg-paper px-3 py-2 text-ink outline-none focus:border-ink"
              >
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Notes" value={manualNotes} onChange={setManualNotes} placeholder="Anything else worth remembering" />
          </div>

          {manualError && (
            <div className="mt-4">
              <ErrorBanner message={manualError} />
            </div>
          )}

          <button
            onClick={submitManualExpense}
            disabled={savingManual || !manualAmount}
            className="mt-6 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-paper disabled:opacity-40"
          >
            {savingManual ? "Saving…" : "Continue"}
          </button>
        </div>
      )}

      {step === "extracted" && expense && (
        <div>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">
            {expense.extractionFailed ? "Couldn't read that image" : "Expense detected"}
          </h1>
          {expense.extractionFailed ? (
            <div className="mb-6">
              <ErrorBanner message="We couldn't make out the details in that image. No problem — just fill them in below yourself." />
            </div>
          ) : (
            <p className="mb-6 text-sm text-ink-soft">
              Read via {expense.extractionMethod === "ocr" ? "OCR + text AI" : "AI vision"}. Check the details and fix
              anything that's wrong.
            </p>
          )}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_1.2fr]">
            {previewUrl && (
              <img src={previewUrl} alt="Uploaded" className="max-h-80 rounded-xl border border-border object-contain" />
            )}
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <Field label="Merchant" value={expense.merchant ?? ""} onChange={(v) => setExpense({ ...expense, merchant: v })} />
              <Field label="Date" value={expense.date ?? ""} onChange={(v) => setExpense({ ...expense, date: v })} />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Total"
                  value={expense.total?.toString() ?? ""}
                  onChange={(v) => setExpense({ ...expense, total: v ? Number(v) : 0 })}
                  type="number"
                />
                <Field label="Currency" value={expense.currency ?? ""} onChange={(v) => setExpense({ ...expense, currency: v })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Tax" value={expense.tax?.toString() ?? ""} onChange={(v) => setExpense({ ...expense, tax: v ? Number(v) : null })} type="number" />
                <Field label="Tip" value={expense.tip?.toString() ?? ""} onChange={(v) => setExpense({ ...expense, tip: v ? Number(v) : null })} type="number" />
              </div>
              <Field label="Category" value={expense.category ?? ""} onChange={(v) => setExpense({ ...expense, category: v })} />
              {expense.paymentMethod && <p className="text-sm text-ink-soft">Payment method: <span className="text-ink">{expense.paymentMethod}</span></p>}
              {expense.transactionReference && (
                <p className="text-sm text-ink-soft">Reference: <span className="text-ink">{expense.transactionReference}</span></p>
              )}
              {expense.visibleNames.length > 0 && (
                <p className="text-sm text-ink-soft">Names visible: <span className="text-ink">{expense.visibleNames.join(", ")}</span></p>
              )}
              {expense.lineItems.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium text-ink">Items</p>
                  <ul className="space-y-1 text-sm text-ink-soft">
                    {expense.lineItems.map((item, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{item.name}</span>
                        <span>{formatCurrency(item.price)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={saveExtractedEdits}
            disabled={!expense.total}
            className="mt-6 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-paper disabled:opacity-40"
          >
            Continue
          </button>
          {!expense.total && <p className="mt-2 text-xs text-ink-faint">Enter a total to continue.</p>}
        </div>
      )}

      {step === "person" && (
        <div>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">Who owes you?</h1>
          <p className="mb-6 text-sm text-ink-soft">Pick someone you've tracked before, or add someone new.</p>

          {!addingNewPerson && (
            <div className="space-y-2">
              {people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => setSelectedPersonId(person.id)}
                  className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors ${
                    selectedPersonId === person.id ? "border-ink bg-ink/[0.03]" : "border-border bg-card hover:border-ink/30"
                  }`}
                >
                  <div>
                    <p className="font-medium text-ink">{person.name}</p>
                    <p className="text-sm text-ink-faint">
                      @{person.telegramUsername} · {person.relationship ?? "no relationship set"}
                      {person.telegramVerified && <span className="text-[var(--color-success)]"> · verified</span>}
                    </p>
                  </div>
                  {person.totalOwed > 0 && (
                    <span className="text-sm font-medium text-accent-dark">{formatCurrency(person.totalOwed)} owed</span>
                  )}
                </button>
              ))}
              <button
                onClick={() => setAddingNewPerson(true)}
                className="w-full rounded-xl border border-dashed border-border p-4 text-left text-sm font-medium text-ink-soft hover:border-ink/30 hover:text-ink"
              >
                + Add a new person
              </button>
            </div>
          )}

          {addingNewPerson && (
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <Field label="Name" value={newPersonName} onChange={setNewPersonName} />
              <Field label="Telegram username" value={newPersonUsername} onChange={setNewPersonUsername} placeholder="rahul123" />
              <Field label="Phone number" value={newPersonPhone} onChange={setNewPersonPhone} placeholder="Optional" />
              <Field label="Relationship" value={newPersonRelationship} onChange={setNewPersonRelationship} placeholder="Friend, roommate, coworker…" />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">
                  Describe them (optional, but shapes the reminder's tone)
                </span>
                <textarea
                  value={newPersonDescription}
                  onChange={(e) => setNewPersonDescription(e.target.value)}
                  placeholder="e.g. laid-back, jokes around a lot, always forgets to pay but means well"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border bg-paper p-3 text-sm text-ink outline-none focus:border-ink"
                />
              </label>
              <button onClick={() => setAddingNewPerson(false)} className="text-sm font-medium text-ink-soft hover:text-ink">
                ← Choose an existing person instead
              </button>
            </div>
          )}

          {personError && (
            <div className="mt-4">
              <ErrorBanner message={personError} />
            </div>
          )}

          <button
            onClick={confirmPerson}
            disabled={savingPerson || (!addingNewPerson && !selectedPersonId)}
            className="mt-6 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-paper disabled:opacity-40"
          >
            {savingPerson ? "Saving…" : "Continue"}
          </button>
        </div>
      )}

      {step === "amount" && expense && (
        <div>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">How much do they owe?</h1>
          <p className="mb-6 text-sm text-ink-soft">Expense total was {formatCurrency(expense.total)}.</p>

          <div className="grid grid-cols-3 gap-3">
            {(["FULL", "HALF", "CUSTOM"] as ShareMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-xl border p-4 text-center font-medium capitalize transition-colors ${
                  mode === m ? "border-ink bg-ink/[0.03] text-ink" : "border-border bg-card text-ink-soft hover:border-ink/30"
                }`}
              >
                {m === "FULL" ? "Full amount" : m.toLowerCase()}
              </button>
            ))}
          </div>

          {mode === "CUSTOM" && (
            <div className="mt-4">
              <Field label="Custom amount" value={customAmount} onChange={setCustomAmount} type="number" />
            </div>
          )}

          {mode && computedAmount !== null && !customAmountInvalid && (
            <p className="mt-5 font-display text-xl font-bold text-ink">
              {people.find((p) => p.id === selectedPersonId)?.name ?? "This person"} owes {formatCurrency(computedAmount)}
            </p>
          )}

          <div className="mt-6 space-y-4 rounded-2xl border border-border bg-card p-5">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Additional context (optional)</span>
              <textarea
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="Anything worth knowing — e.g. they already said they'd pay Friday"
                rows={2}
                className="w-full resize-none rounded-lg border border-border bg-paper p-3 text-sm text-ink outline-none focus:border-ink"
              />
            </label>

            <div>
              <span className="mb-1 block text-sm font-medium text-ink">What do you want them to do? (optional)</span>
              <div className="flex flex-wrap gap-2">
                {DESIRED_ACTIONS.map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => setDesiredActionChoice(desiredActionChoice === action ? "" : action)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      desiredActionChoice === action ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
                    }`}
                  >
                    {action}
                  </button>
                ))}
              </div>
              {desiredActionChoice === "Other" && (
                <input
                  value={customDesiredAction}
                  onChange={(e) => setCustomDesiredAction(e.target.value)}
                  placeholder="Type what you want them to do"
                  className="mt-2 w-full rounded-lg border border-border bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                />
              )}
            </div>
          </div>

          {amountError && (
            <div className="mt-4">
              <ErrorBanner message={amountError} />
            </div>
          )}

          <button
            onClick={confirmAmount}
            disabled={!mode || customAmountInvalid || confirmingAmount}
            className="mt-6 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-paper disabled:opacity-40"
          >
            {confirmingAmount ? "Confirming…" : "Confirm"}
          </button>
        </div>
      )}

      {step === "message" && debt && (
        <div>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">Your reminder</h1>
          <p className="mb-6 text-sm text-ink-soft">
            Built automatically from the expense, {debt.personName}'s history, and your relationship.
          </p>

          {generating && !debt.message && <p className="text-sm text-ink-soft">Writing a reminder…</p>}

          {debt.message && !editingMessage && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center justify-between border-b border-border pb-4 text-sm">
                <div>
                  <p className="text-ink-faint">To</p>
                  <p className="font-medium text-ink">
                    {debt.personName}
                    {people.find((p) => p.id === debt.personId) && (
                      <span className="text-ink-faint"> @{people.find((p) => p.id === debt.personId)!.telegramUsername}</span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-ink-faint">Amount</p>
                  <p className="font-medium text-ink">{formatCurrency(debt.amount)}</p>
                </div>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <ToneBadge tone={debt.tone} />
                {debt.messageEdited && <span className="text-xs text-ink-faint">edited by you</span>}
              </div>
              <p className="font-display text-lg leading-relaxed text-ink">"{debt.message}"</p>
              {reasoning && <p className="mt-4 text-xs text-ink-faint">Why this tone: {reasoning}</p>}
            </div>
          )}

          {editingMessage && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-lg border border-border bg-paper p-3 text-ink outline-none focus:border-ink"
              />
              <div className="mt-3 flex gap-2">
                <button onClick={saveEditedMessage} className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper">
                  Save edit
                </button>
                <button
                  onClick={() => {
                    setEditingMessage(false);
                    setDraftText(debt.message ?? "");
                  }}
                  className="text-sm font-medium text-ink-soft hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {messageError && (
            <div className="mt-4 space-y-2">
              <ErrorBanner message={messageError.message} onRetry={handleSend} />
              {messageError.notVerified && (
                <p className="text-xs text-ink-faint">
                  Once they've messaged the bot, click "Send via Telegram" again — no need to redo anything above.
                </p>
              )}
            </div>
          )}

          {debt.message && !editingMessage && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                onClick={() => runGenerate(debt.id, debt.tone ?? undefined, true)}
                disabled={generating}
                className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-ink hover:border-ink/40 disabled:opacity-40"
              >
                {generating ? "Regenerating…" : "Regenerate"}
              </button>
              <div className="flex items-center gap-1">
                {TONES.map((tone) => (
                  <button
                    key={tone}
                    onClick={() => runGenerate(debt.id, tone, false)}
                    disabled={generating}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      debt.tone === tone ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
                    }`}
                  >
                    {tone}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setDraftText(debt.message ?? "");
                  setEditingMessage(true);
                }}
                className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-ink hover:border-ink/40"
              >
                Edit
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="ml-auto rounded-full bg-accent px-5 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {sending ? "Sending…" : "Send via Telegram"}
              </button>
            </div>
          )}
        </div>
      )}

      {step === "done" && sendResult && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-display text-xl font-bold text-ink">Sent!</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">{sendResult.note}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button onClick={() => navigate("/reminders")} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper">
              View reminders
            </button>
            <button onClick={() => navigate("/dashboard")} className="rounded-full border border-border px-5 py-2 text-sm font-medium text-ink">
              Back to dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
