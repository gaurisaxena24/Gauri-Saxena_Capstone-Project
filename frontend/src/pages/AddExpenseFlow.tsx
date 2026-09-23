import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  createDebt,
  createManualExpense,
  createPerson,
  extractExpenseFromImage,
  generateMessage,
  editMessage,
  getHealth,
  listPeople,
  removeDebt,
  sendDebtViaTelegram,
  updateExpense,
  type DebtSummary,
  type Expense,
  type ExpenseLineItem,
  type PersonSummary,
} from "../api/client";
import { formatCurrency } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";
import { ToneBadge } from "../components/ToneBadge";
import { useAuth } from "../context/AuthContext";

type Step = "choice" | "upload" | "manual" | "extracted" | "people" | "items" | "review" | "done";

type TaxHandling = "proportional" | "excluded" | "manual";

function newLineItemId(): string {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function itemLineTotal(item: ExpenseLineItem): number {
  return Number.isFinite(item.price) ? item.price : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// The FIRST reminder is the only one a person ever picks a tone for by hand — every reminder after
// it is sent automatically by backend/reminders/scheduler.ts, which escalates through
// "Passive-Aggressive" and then "Angry" on its own (see skills/escalationSkill.ts). Those two stay
// reserved for automatic escalation, so the manual picker only ever offers these three.
const INITIAL_TONES = ["Casual", "Funny", "Unhinged"] as const;
const PAYMENT_METHODS = ["UPI", "Google Pay", "Cash", "Card", "Bank Transfer", "Other"];
const DESIRED_ACTIONS = [
  "Send their share",
  "Pay the full amount",
  "Send it today",
  "Tell me when they'll pay",
  "Other",
];

/**
 * A person-in-progress record used only while calculating shares. This is a per-item
 * assignment key, never sent to the backend — the payer's key never becomes a debt row.
 */
interface RecipientCard {
  debt: DebtSummary;
  generating: boolean;
  generationError: string | null;
  reasoning: string | null;
  editingMessage: boolean;
  editError: string | null;
  draftText: string;
  sending: boolean;
  sendError: { message: string; notVerified: boolean } | null;
  sent: boolean;
  selectedForSend: boolean;
}

function StepIndicator({ current }: { current: Step }) {
  const order: Step[] = ["choice", "people", "items", "review"];
  const labels: Record<string, string> = { choice: "Expense", people: "People", items: "Split", review: "Send" };
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
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("choice");
  // Synchronous double-send guard for sendOne — see its own comment for why `sending` state alone isn't enough.
  const sendingIdsRef = useRef<Set<number>>(new Set());

  // The payer is the currently authenticated session user (see AuthContext / backend/api/routes/auth.ts).
  // This key is used ONLY to track the payer's own inclusion in an item's split for the arithmetic
  // below — it is never sent to the backend and never becomes a debt row or a rendered "your share" line.
  const payerKey = user ? `payer-${user.id}` : "payer";

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

  // People who were there (existing verified-contacts feature) — the payer is never in this list.
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<Set<number>>(new Set());
  const [addingNewPerson, setAddingNewPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonUsername, setNewPersonUsername] = useState("");
  const [newPersonRelationship, setNewPersonRelationship] = useState("");
  const [newPersonPhone, setNewPersonPhone] = useState("");
  const [newPersonDescription, setNewPersonDescription] = useState("");
  const [personError, setPersonError] = useState<string | null>(null);
  const [savingPerson, setSavingPerson] = useState(false);
  const [loadingPeople, setLoadingPeople] = useState(false);

  // Item-level assignment: itemAssignments[item.id] = Set of keys ("payer-<id>" or String(personId))
  // of everyone who shared that item. An item's price is split equally among its assigned keys.
  const [editableItems, setEditableItems] = useState<ExpenseLineItem[]>([]);
  const [itemAssignments, setItemAssignments] = useState<Record<string, Set<string>>>({});
  const [taxHandling, setTaxHandling] = useState<TaxHandling>("proportional");
  const [manualTaxAdjustment, setManualTaxAdjustment] = useState("");
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [creatingDebts, setCreatingDebts] = useState(false);

  // Optional context for the AI message — applied to every recipient created from this bill.
  const [additionalContext, setAdditionalContext] = useState("");
  const [desiredActionChoice, setDesiredActionChoice] = useState("");
  const [customDesiredAction, setCustomDesiredAction] = useState("");

  // One card per non-payer person who ends up owing something. The payer never appears here.
  const [recipients, setRecipients] = useState<RecipientCard[]>([]);

  // Read once for the "Approve & schedule" button/copy below — single source of truth is the
  // backend's REMINDER_INTERVAL_MINUTES (backend/reminders/schedulerConfig.ts), never a hardcoded
  // number here. Falls back to 5 (the real default) only if the health check hasn't resolved yet.
  const [reminderIntervalMinutes, setReminderIntervalMinutes] = useState(5);
  useEffect(() => {
    getHealth()
      .then((health) => setReminderIntervalMinutes(health.reminderIntervalMinutes))
      .catch(() => {});
  }, []);

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

  async function loadPeople() {
    setLoadingPeople(true);
    try {
      const res = await listPeople();
      setPeople(res.people);
    } catch {
      setPeople([]);
    } finally {
      setLoadingPeople(false);
    }
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
      setStep("people");
      loadPeople();
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
    setStep("people");
    loadPeople();
  }

  // ---- People step (who was there — payer excluded, existing contacts feature) ----

  function togglePersonSelected(id: number) {
    setSelectedPeopleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addNewPerson() {
    setPersonError(null);
    if (!newPersonName.trim()) {
      setPersonError("Name is required.");
      return;
    }
    setSavingPerson(true);
    try {
      const person = await createPerson({
        name: newPersonName.trim(),
        telegramUsername: newPersonUsername.trim() || undefined,
        relationship: newPersonRelationship.trim() || undefined,
        phoneNumber: newPersonPhone.trim() || undefined,
        notes: newPersonDescription.trim() || undefined,
      });
      await loadPeople();
      setSelectedPeopleIds((prev) => new Set(prev).add(person.id));
      setAddingNewPerson(false);
      setNewPersonName("");
      setNewPersonUsername("");
      setNewPersonRelationship("");
      setNewPersonPhone("");
      setNewPersonDescription("");
    } catch (err) {
      setPersonError(err instanceof Error ? err.message : "Couldn't save that person.");
    } finally {
      setSavingPerson(false);
    }
  }

  function continueFromPeople() {
    if (selectedPeopleIds.size === 0) {
      setPersonError("Select at least one person.");
      return;
    }
    setPersonError(null);
    goToItemsPhase();
  }

  // ---- Item-level assignment ----

  /** Itemized bills split item-by-item; anything else (manual entry, or an image with no line
   * items) becomes a single synthetic "item" covering the whole total, so the same equal-split
   * machinery below handles both cases without a separate whole/half/other mode. */
  function goToItemsPhase() {
    const baseItems: ExpenseLineItem[] =
      expense?.source === "IMAGE" && expense.lineItems.length > 0
        ? expense.lineItems
        : [
            {
              id: newLineItemId(),
              name: expense?.description || expense?.merchant || "Expense",
              quantity: 1,
              unitPrice: expense?.total ?? 0,
              price: expense?.total ?? 0,
              uncertain: false,
            },
          ];
    setEditableItems(baseItems);
    const defaultKeys = [payerKey, ...Array.from(selectedPeopleIds, String)];
    const assignments: Record<string, Set<string>> = {};
    baseItems.forEach((item) => {
      assignments[item.id] = new Set(defaultKeys);
    });
    setItemAssignments(assignments);
    setTaxHandling("proportional");
    setManualTaxAdjustment("");
    setItemsError(null);
    setStep("items");
  }

  function toggleItemPerson(itemId: string, key: string) {
    setItemAssignments((prev) => {
      const next = { ...prev };
      const set = new Set(next[itemId] ?? []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next[itemId] = set;
      return next;
    });
  }

  function updateItem(id: string, patch: Partial<Pick<ExpenseLineItem, "name" | "quantity" | "unitPrice" | "price">>) {
    setEditableItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch, uncertain: false };
        if ((patch.quantity !== undefined || patch.unitPrice !== undefined) && patch.price === undefined) {
          const qty = patch.quantity !== undefined ? patch.quantity : item.quantity;
          const unit = patch.unitPrice !== undefined ? patch.unitPrice : item.unitPrice;
          if (qty !== null && unit !== null) next.price = qty * unit;
        }
        return next;
      })
    );
  }

  function deleteItem(id: string) {
    setEditableItems((prev) => prev.filter((item) => item.id !== id));
    setItemAssignments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function addItem() {
    const id = newLineItemId();
    setEditableItems((prev) => [...prev, { id, name: "", quantity: 1, unitPrice: null, price: 0, uncertain: false }]);
    setItemAssignments((prev) => ({ ...prev, [id]: new Set([payerKey, ...Array.from(selectedPeopleIds, String)]) }));
  }

  const allItemsTotal = editableItems.reduce((sum, i) => sum + itemLineTotal(i), 0);
  const netExtraCharges =
    (expense?.tax ?? 0) + (expense?.serviceCharge ?? 0) - (expense?.discount ?? 0) + (expense?.tip ?? 0);
  const hasExtraCharges = netExtraCharges !== 0;
  const taxAdjustment =
    taxHandling === "proportional" ? netExtraCharges : taxHandling === "excluded" ? 0 : Number(manualTaxAdjustment || 0);
  const previewAdjustedTotal = allItemsTotal + (hasExtraCharges ? taxAdjustment : 0);
  const anyItemUnassigned = editableItems.some((item) => (itemAssignments[item.id]?.size ?? 0) === 0);

  const resolvedDesiredAction = desiredActionChoice === "Other" ? customDesiredAction.trim() : desiredActionChoice;

  /**
   * Splits every item equally among whoever is checked for it (payer included in the headcount
   * when checked, never in the output), sums each person's per-item shares (payer included, purely
   * for the arithmetic below), distributes the bill's tax/service charge/discount/tip proportionally
   * to each person's pre-adjustment item subtotal, rounds to the paisa with any leftover remainder
   * absorbed into the payer's own hidden share (see the comment further down for why), then creates
   * one debt per non-payer person who ends up owing more than zero. Nobody who wasn't assigned to
   * anything, and the payer themselves, is ever included in the result.
   */
  async function proceedToReview() {
    if (!expense) return;
    if (editableItems.length === 0) {
      setItemsError("Add at least one item.");
      return;
    }
    if (anyItemUnassigned) {
      setItemsError("Every item needs at least one person selected before shares can be calculated.");
      return;
    }
    setItemsError(null);

    const perPersonPretax = new Map<string, number>();
    const perPersonItems = new Map<string, Array<{ name: string; amount: number }>>();

    for (const item of editableItems) {
      const assigned = itemAssignments[item.id] ?? new Set<string>();
      const price = itemLineTotal(item);
      const share = assigned.size > 0 ? price / assigned.size : 0;
      for (const key of assigned) {
        perPersonPretax.set(key, (perPersonPretax.get(key) ?? 0) + share);
        if (key !== payerKey) {
          const list = perPersonItems.get(key) ?? [];
          list.push({ name: item.name || "Item", amount: round2(share) });
          perPersonItems.set(key, list);
        }
      }
    }

    // Distribute tax/service charge/discount/tip proportionally to each person's (unrounded) share
    // of the pre-adjustment item subtotal -- including the payer's own hidden share, since the
    // payer's fraction of the bill is needed to work out everyone else's fraction correctly.
    if (!perPersonPretax.has(payerKey)) perPersonPretax.set(payerKey, 0);
    const exactFinals = new Map<string, number>();
    for (const [key, pretax] of perPersonPretax) {
      const adjShare = hasExtraCharges && allItemsTotal > 0 ? (pretax / allItemsTotal) * taxAdjustment : 0;
      exactFinals.set(key, pretax + adjShare);
    }

    // Round every person's share to paise using integer-cent arithmetic (avoids float drift), then
    // hand whatever tiny leftover the roundings create to the payer's own hidden share -- never to
    // a share that is actually shown to, or collected from, another person. That keeps every
    // visible/collected amount exactly equal to that person's fair rounded proportional share,
    // while payer + everyone else still reconciles exactly, to the paisa, to item subtotal + tax +
    // service charge - discount + tip. This must hold even with no adjustments at all.
    const totalPaise = Math.round((allItemsTotal + (hasExtraCharges ? taxAdjustment : 0)) * 100);
    const roundedPaise = new Map<string, number>();
    let sumPaise = 0;
    for (const [key, exact] of exactFinals) {
      const paise = Math.round(exact * 100);
      roundedPaise.set(key, paise);
      sumPaise += paise;
    }
    const remainderPaise = totalPaise - sumPaise;
    if (remainderPaise !== 0) {
      roundedPaise.set(payerKey, (roundedPaise.get(payerKey) ?? 0) + remainderPaise);
    }

    const results: Array<{ personId: number; amount: number; items: Array<{ name: string; amount: number }> }> = [];
    for (const personId of selectedPeopleIds) {
      const key = String(personId);
      const final = (roundedPaise.get(key) ?? 0) / 100;
      if (final <= 0) continue;
      // perPersonItems holds each item's raw pre-tax/tip share; scale it by this person's own
      // final/pretax ratio so the displayed item breakdown actually sums to `final` (the real
      // amount owed) instead of silently omitting their share of tax/service/discount/tip.
      const pretax = perPersonPretax.get(key) ?? 0;
      const ratio = pretax > 0 ? final / pretax : 1;
      const rawItems = perPersonItems.get(key) ?? [];
      const items = ratio === 1 ? rawItems : rawItems.map((i) => ({ ...i, amount: round2(i.amount * ratio) }));
      results.push({ personId, amount: final, items });
    }

    setCreatingDebts(true);
    if (recipients.length > 0) {
      // If this is a recalculation after Back → edit → Calculate shares again, the debts
      // currently in `recipients` were created by a previous run of this same function for
      // this same expense — delete them first so the new results replace rather than
      // duplicate them. Only ever touches debts this flow itself created in this session.
      // Promise.allSettled (not .all): if some deletes fail, `recipients` is trimmed down to only
      // the ones that are still actually undeleted, so a retry re-attempts just those instead of
      // re-deleting already-gone ids (which would 404 forever and strand this flow).
      const settled = await Promise.allSettled(recipients.map((r) => removeDebt(r.debt.id)));
      const stillNeedsRemoval = recipients.filter((_, i) => settled[i].status === "rejected");
      if (stillNeedsRemoval.length > 0) {
        setRecipients(stillNeedsRemoval);
        setCreatingDebts(false);
        setItemsError("Couldn't clear all previous shares before recalculating — try again.");
        return;
      }
      setRecipients([]);
    }

    if (results.length === 0) {
      setRecipients([]);
      setStep("review");
      setCreatingDebts(false);
      return;
    }

    try {
      const created = await Promise.all(
        results.map((r) =>
          createDebt({
            expenseId: expense.id,
            personId: r.personId,
            mode: "CUSTOM",
            customAmount: r.amount,
            selectedItems: r.items.length > 0 ? r.items : undefined,
            additionalContext: additionalContext.trim() || undefined,
            desiredAction: resolvedDesiredAction || undefined,
          })
        )
      );
      const cards: RecipientCard[] = created.map((debt) => ({
        debt,
        generating: false,
        generationError: null,
        reasoning: null,
        editingMessage: false,
        editError: null,
        draftText: debt.message ?? "",
        sending: false,
        sendError: null,
        sent: false,
        selectedForSend: true,
      }));
      setRecipients(cards);
      setStep("review");
      cards.forEach((c) => runGenerateFor(c.debt.id, undefined, false));
    } catch (err) {
      setItemsError(err instanceof Error ? err.message : "Couldn't calculate shares.");
    } finally {
      setCreatingDebts(false);
    }
  }

  // ---- Review / send (payer never appears here — only people who owe the payer) ----

  async function runGenerateFor(debtId: number, tone: string | undefined, regenerate: boolean) {
    setRecipients((prev) => prev.map((c) => (c.debt.id === debtId ? { ...c, generating: true, generationError: null } : c)));
    try {
      const result = await generateMessage(debtId, { tone, regenerate });
      setRecipients((prev) =>
        prev.map((c) =>
          c.debt.id === debtId
            ? {
                ...c,
                debt: { ...c.debt, message: result.message, tone: result.tone },
                reasoning: result.reasoning || null,
                draftText: result.message ?? "",
                generating: false,
              }
            : c
        )
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't generate the message. Please try again.";
      setRecipients((prev) => prev.map((c) => (c.debt.id === debtId ? { ...c, generating: false, generationError: message } : c)));
    }
  }

  async function saveEditedMessageFor(debtId: number) {
    const card = recipients.find((c) => c.debt.id === debtId);
    if (!card) return;
    setRecipients((prev) => prev.map((c) => (c.debt.id === debtId ? { ...c, editError: null } : c)));
    try {
      const updated = await editMessage(debtId, card.draftText);
      setRecipients((prev) => prev.map((c) => (c.debt.id === debtId ? { ...c, debt: updated, editingMessage: false } : c)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save your edit.";
      setRecipients((prev) => prev.map((c) => (c.debt.id === debtId ? { ...c, editError: message } : c)));
    }
  }

  async function sendOne(debtId: number) {
    // `sending` in React state alone can race: a fast double-click (e.g. on "Retry Send") can fire
    // this twice before the first setRecipients call above commits and re-renders, so both calls
    // would read the same stale `sending: false` and both send a real duplicate Telegram message.
    // sendingIdsRef is checked and updated synchronously, before any state update or await, to close
    // that window.
    if (sendingIdsRef.current.has(debtId)) return;
    sendingIdsRef.current.add(debtId);
    setRecipients((prev) => prev.map((c) => (c.debt.id === debtId ? { ...c, sending: true, sendError: null } : c)));
    try {
      await sendDebtViaTelegram(debtId);
      setRecipients((prev) => prev.map((c) => (c.debt.id === debtId ? { ...c, sending: false, sent: true } : c)));
    } catch (err) {
      const notVerified = err instanceof ApiError && err.notVerified;
      const message = err instanceof Error ? err.message : "Couldn't send the message.";
      setRecipients((prev) => prev.map((c) => (c.debt.id === debtId ? { ...c, sending: false, sendError: { message, notVerified } } : c)));
    } finally {
      sendingIdsRef.current.delete(debtId);
    }
  }

  /** Sends every selected, not-yet-sent, ready recipient's message in one action. */
  async function sendSelected() {
    const targets = recipients.filter((c) => c.selectedForSend && !c.sent && c.debt.message && !c.sending);
    await Promise.all(targets.map((c) => sendOne(c.debt.id)));
  }

  const sendingAny = recipients.some((c) => c.sending);
  const canSendSelected = recipients.some((c) => c.selectedForSend && !c.sent && c.debt.message && !c.sending);

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

      {step === "people" && (
        <div>
          <button
            onClick={() => setStep(expense?.source === "IMAGE" ? "extracted" : "manual")}
            className="mb-4 text-sm text-ink-soft hover:text-ink"
          >
            ← Back
          </button>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">Who was there?</h1>
          <p className="mb-6 text-sm text-ink-soft">
            Select everyone else involved in this bill — you'll assign who had what next. (You're always
            included automatically as the payer — no need to add yourself.)
          </p>

          {loadingPeople && <p className="mb-4 text-sm text-ink-soft">Loading people…</p>}

          {!addingNewPerson && (
            <div className="space-y-2">
              {people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => togglePersonSelected(person.id)}
                  className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors ${
                    selectedPeopleIds.has(person.id) ? "border-ink bg-ink/[0.03]" : "border-border bg-card hover:border-ink/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input type="checkbox" readOnly checked={selectedPeopleIds.has(person.id)} className="h-4 w-4" />
                    <div>
                      <p className="font-medium text-ink">{person.name}</p>
                      <p className="text-sm text-ink-faint">
                        {person.telegramUsername ? `@${person.telegramUsername}` : "No Telegram username"} ·{" "}
                        {person.relationship ?? "no relationship set"}
                        {person.telegramVerified && <span className="text-[var(--color-success)]"> · verified</span>}
                      </p>
                    </div>
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
              <Field
                label="Telegram username (optional)"
                value={newPersonUsername}
                onChange={setNewPersonUsername}
                placeholder="rahul123 — only needed to send them Telegram reminders"
              />
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

          {addingNewPerson ? (
            <button
              onClick={addNewPerson}
              disabled={savingPerson}
              className="mt-6 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-paper disabled:opacity-40"
            >
              {savingPerson ? "Saving…" : "Add person"}
            </button>
          ) : (
            <button
              onClick={continueFromPeople}
              disabled={selectedPeopleIds.size === 0}
              className="mt-6 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-paper disabled:opacity-40"
            >
              Continue
            </button>
          )}
        </div>
      )}

      {step === "items" && expense && (
        <div>
          <button onClick={() => setStep("people")} className="mb-4 text-sm text-ink-soft hover:text-ink">
            ← Back
          </button>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">Who had what?</h1>
          <p className="mb-2 text-sm text-ink-soft">
            For each item, select everyone who shared it — including "Me" if you had some too. Its price splits
            equally among whoever's selected. Fix anything OCR/vision got wrong.
          </p>
          <p className="mb-6 text-xs text-ink-faint">
            Under "Had this:" — <span className="rounded-full bg-ink px-2 py-0.5 text-paper">black</span> means that
            person is included in this item's split; <span className="rounded-full bg-ink/5 px-2 py-0.5 text-ink-soft">grey</span> means they're not.
          </p>

          {expense.confidence !== null && expense.confidence < 0.5 && (
            <div className="mb-4">
              <ErrorBanner message="This image was hard to read clearly — double-check the items below and fix or add anything that's missing." />
            </div>
          )}

          <div className="space-y-3">
            {editableItems.map((item) => {
              const assigned = itemAssignments[item.id] ?? new Set<string>();
              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-3 ${
                    item.uncertain ? "border-amber-400 bg-amber-50/40" : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      value={item.name}
                      onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      placeholder="Item name"
                      className="min-w-0 flex-1 rounded-md border border-border bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-ink"
                    />
                    <span className="text-xs text-ink-faint">₹</span>
                    <input
                      type="number"
                      value={item.price}
                      onChange={(e) => updateItem(item.id, { price: Number(e.target.value) || 0 })}
                      placeholder="Amount"
                      className="w-24 rounded-md border border-border bg-paper px-2 py-1 text-sm font-medium text-ink outline-none focus:border-ink"
                    />
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="shrink-0 text-ink-faint hover:text-red-500"
                      aria-label="Delete item"
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-1">
                    <span className="text-xs text-ink-faint">Had this:</span>
                    <button
                      type="button"
                      onClick={() => toggleItemPerson(item.id, payerKey)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        assigned.has(payerKey) ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
                      }`}
                    >
                      Me
                    </button>
                    {people
                      .filter((p) => selectedPeopleIds.has(p.id))
                      .map((p) => {
                        const key = String(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggleItemPerson(item.id, key)}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                              assigned.has(key) ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                  </div>
                  {assigned.size === 0 && (
                    <p className="mt-1 pl-1 text-xs text-[var(--color-danger)]">Select at least one person for this item.</p>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={addItem}
            className="mt-3 w-full rounded-xl border border-dashed border-border p-3 text-left text-sm font-medium text-ink-soft hover:border-ink/30 hover:text-ink"
          >
            + Add item
          </button>

          <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-card p-4 text-sm">
            <span className="text-ink-soft">Items total</span>
            <span className="font-display text-lg font-bold text-ink">{formatCurrency(allItemsTotal)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-xs text-ink-faint">
            <span>Bill total (extracted)</span>
            <span>{formatCurrency(expense.total)}</span>
          </div>

          {hasExtraCharges && (
            <div className="mt-4 space-y-3 rounded-2xl border border-border bg-card p-5">
              <p className="text-sm font-medium text-ink">
                This bill has tax/service/discount/tip ({formatCurrency(netExtraCharges)} net) — how should it apply?
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["proportional", "Split proportionally"],
                    ["excluded", "Excluded"],
                    ["manual", "Manually adjust"],
                  ] as Array<[TaxHandling, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTaxHandling(value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      taxHandling === value ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {taxHandling === "manual" && (
                <Field
                  label="Adjustment amount (+ to add, - to subtract)"
                  value={manualTaxAdjustment}
                  onChange={setManualTaxAdjustment}
                  type="number"
                />
              )}
              <p className="text-xs text-ink-faint">
                Each person's tax/service/discount/tip cut is proportional to their share of the items — split across
                whoever's assigned to each item, same as the item prices. Items ({formatCurrency(allItemsTotal)}){" "}
                {taxAdjustment >= 0 ? "+" : "-"} {formatCurrency(Math.abs(taxAdjustment))} = {formatCurrency(previewAdjustedTotal)}
              </p>
            </div>
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

          {itemsError && (
            <div className="mt-4">
              <ErrorBanner message={itemsError} />
            </div>
          )}

          <button
            onClick={proceedToReview}
            disabled={creatingDebts || anyItemUnassigned || editableItems.length === 0}
            className="mt-6 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-paper disabled:opacity-40"
          >
            {creatingDebts ? "Calculating…" : "Calculate shares"}
          </button>
        </div>
      )}

      {step === "review" && (
        <div>
          <button onClick={() => setStep("items")} className="mb-4 text-sm text-ink-soft hover:text-ink">
            ← Back
          </button>
          <h1 className="font-display mb-2 text-2xl font-bold text-ink">People who owe you</h1>

          {recipients.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center">
              <p className="font-medium text-ink">Nobody owes you anything from this bill.</p>
              <p className="mt-1 text-sm text-ink-soft">Every item ended up assigned only to you.</p>
            </div>
          ) : (
            <>
              <p className="mb-6 text-sm text-ink-soft">
                Pick who to send a reminder to, then approve. Once you approve and it sends, follow-up
                reminders for that person continue automatically every {reminderIntervalMinutes} minute
                {reminderIntervalMinutes === 1 ? "" : "s"} (test mode) — escalating in tone with no further
                approval needed — until you mark the debt as paid.
              </p>
              <div className="space-y-4">
                {recipients.map((r) => (
                  <div key={r.debt.id} className="rounded-2xl border border-border bg-card p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={r.selectedForSend}
                          disabled={r.sent}
                          onChange={() =>
                            setRecipients((prev) =>
                              prev.map((x) => (x.debt.id === r.debt.id ? { ...x, selectedForSend: !x.selectedForSend } : x))
                            )
                          }
                        />
                        <span className="font-medium text-ink">{r.debt.personName}</span>
                      </label>
                      <span className="font-display text-lg font-bold text-ink">{formatCurrency(r.debt.amount)}</span>
                    </div>

                    {r.debt.selectedItems && r.debt.selectedItems.length > 0 && (
                      <p className="mb-2 text-xs text-ink-faint">For: {r.debt.selectedItems.map((i) => i.name).join(", ")}</p>
                    )}

                    {r.generating && !r.debt.message && <p className="text-sm text-ink-soft">Writing a reminder…</p>}

                    {!r.debt.message && !r.generating && r.generationError && (
                      <div className="rounded-xl border border-border bg-paper p-4 text-center">
                        <p className="text-sm text-ink-soft">{r.generationError}</p>
                        <button
                          type="button"
                          onClick={() => runGenerateFor(r.debt.id, undefined, false)}
                          className="mt-2 rounded-full bg-ink px-4 py-1 text-xs font-semibold text-paper"
                        >
                          Try again
                        </button>
                      </div>
                    )}

                    {r.debt.message && !r.editingMessage && (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <ToneBadge tone={r.debt.tone} />
                          {r.debt.messageEdited && <span className="text-xs text-ink-faint">edited by you</span>}
                        </div>
                        <p className="text-ink">"{r.debt.message}"</p>
                      </div>
                    )}

                    {r.editingMessage && (
                      <div>
                        <textarea
                          value={r.draftText}
                          onChange={(e) =>
                            setRecipients((prev) => prev.map((x) => (x.debt.id === r.debt.id ? { ...x, draftText: e.target.value } : x)))
                          }
                          rows={3}
                          className="w-full resize-none rounded-lg border border-border bg-paper p-3 text-ink outline-none focus:border-ink"
                        />
                        {r.editError && <p className="mt-2 text-sm text-[var(--color-danger)]">{r.editError}</p>}
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEditedMessageFor(r.debt.id)}
                            className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper"
                          >
                            Save edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRecipients((prev) =>
                                prev.map((x) => (x.debt.id === r.debt.id ? { ...x, editingMessage: false, draftText: x.debt.message ?? "" } : x))
                              )
                            }
                            className="text-sm font-medium text-ink-soft hover:text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {r.debt.message && !r.editingMessage && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => runGenerateFor(r.debt.id, r.debt.tone ?? undefined, true)}
                          disabled={r.generating}
                          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-ink hover:border-ink/40 disabled:opacity-40"
                        >
                          {r.generating ? "Regenerating…" : "Regenerate"}
                        </button>
                        <div className="flex items-center gap-1">
                          {INITIAL_TONES.map((tone) => (
                            <button
                              type="button"
                              key={tone}
                              onClick={() => runGenerateFor(r.debt.id, tone, false)}
                              disabled={r.generating}
                              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                r.debt.tone === tone ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
                              }`}
                            >
                              {tone}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setRecipients((prev) =>
                              prev.map((x) => (x.debt.id === r.debt.id ? { ...x, editingMessage: true, draftText: x.debt.message ?? "" } : x))
                            )
                          }
                          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-ink hover:border-ink/40"
                        >
                          Edit
                        </button>
                      </div>
                    )}

                    {r.sendError && (
                      <div className="mt-3 space-y-1">
                        <ErrorBanner message={r.sendError.message} onRetry={() => sendOne(r.debt.id)} retryLabel="Retry Send" />
                        {r.sendError.notVerified && (
                          <p className="text-xs text-ink-faint">Once they've messaged the bot, retry sending — no need to redo anything above.</p>
                        )}
                      </div>
                    )}

                    {r.sent && (
                      <p className="mt-3 text-sm font-medium text-[var(--color-success)]">
                        Sent via Telegram. Automatic reminders will now continue every {reminderIntervalMinutes} minute
                        {reminderIntervalMinutes === 1 ? "" : "s"} (test mode) until this is marked as paid.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={sendSelected}
                disabled={sendingAny || !canSendSelected}
                className="mt-6 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {sendingAny ? "Sending…" : "Approve & schedule"}
              </button>
            </>
          )}

          <div className="mt-8 flex justify-start gap-3">
            <button onClick={() => navigate("/dashboard")} className="rounded-full border border-border px-5 py-2 text-sm font-medium text-ink">
              Back to dashboard
            </button>
            <button onClick={() => navigate("/expenses")} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper">
              View expenses
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
