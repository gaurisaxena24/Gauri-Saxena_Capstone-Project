export interface ExpenseLineItem {
  /** Stable id for React keys / item-selection state. Generated if the model didn't give one. */
  id: string;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  /** Line total. Never invented: computed from quantity*unitPrice when both are known and the model didn't give a total directly, otherwise 0. */
  price: number;
  /** True if `price` above couldn't be read or derived with confidence — the UI should flag this item for the user to check/fix rather than treat it as a solid fact. */
  uncertain: boolean;
}

export interface ExpenseExtraction {
  merchant: string | null;
  date: string | null;
  /** Grand total — what the bill/payment actually came to. */
  total: number | null;
  currency: string | null;
  /** Sum of line items before tax/service/discount, if the bill states one distinctly from `total`. */
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  serviceCharge: number | null;
  discount: number | null;
  category: string | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  lineItems: ExpenseLineItem[];
  visibleNames: string[];
  description: string | null;
  /** The model's own confidence (0-1) in this extraction overall — low means the image was hard to read; never a stand-in for validating specific fields. */
  confidence: number | null;
}

export const TONES = ["Casual", "Funny", "Passive-Aggressive", "Unhinged"] as const;
export type Tone = (typeof TONES)[number];

export interface ReminderContext {
  person: {
    name: string;
    telegramUsername: string;
    relationship: string;
    /** Who they are / their personality / how they handle money — shapes HOW the message is written, not just facts it states. */
    description: string | null;
  };
  debt: {
    /** This person's share. */
    amount: number;
    /** The full original expense amount, for reference when amount is a partial share. */
    expenseTotal: number;
    currency: string;
    date: string | null;
    category: string | null;
    reason: string;
    shareMode: "FULL" | "HALF" | "CUSTOM";
    /** Free-text context the user typed when creating this debt (e.g. "she already promised to pay Friday"). */
    additionalContext: string | null;
    /** What the user wants this message to actually ask for (e.g. "Send it today"). */
    desiredAction: string | null;
    /**
     * The actual item(s) this specific debt covers, when it was built from an itemized bill (e.g.
     * [{name: "Chicken Biryani", amount: 450}, {name: "Coke", amount: 120}]) — real selected rows
     * only, never the whole bill's item list. Null when the debt is a flat amount with no item
     * breakdown (manual entry, or a non-itemized screenshot).
     */
    items: Array<{ name: string; amount: number }> | null;
  };
  history: {
    previousDebts: number;
    previousReminders: number;
    previousPaidDebts: number;
    daysOutstanding: number;
    /** Tone actually used the last time a reminder was sent to this person, or null if never. Real fact, not a guess — lets the model escalate/continue consistently instead of restarting cold every time. */
    lastReminderTone: Tone | null;
    /**
     * This person's OTHER currently-unpaid debts (excludes the one this message is about). Real
     * rows only — never invented. Lets the model naturally acknowledge "there's also X" without
     * ever merging amounts: this message must still only ask for `debt.amount` above.
     */
    otherOpenDebts: Array<{ amount: number; reason: string; daysOutstanding: number }>;
  };
}

export interface GeneratedReminder {
  tone: Tone;
  reasoning: string;
  message: string;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("GROQ_API_KEY is not configured. Add it to your .env file to enable AI features.");
    this.name = "AiNotConfiguredError";
  }
}

export class AiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRequestError";
  }
}

/** Extracts the first {...} or [...] JSON value from a model response, tolerating stray prose/fencing. */
export function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new AiRequestError("AI response did not contain JSON.");
  try {
    return JSON.parse(candidate.slice(start)) as T;
  } catch {
    throw new AiRequestError("AI response contained malformed JSON.");
  }
}

export function emptyExpenseExtraction(): ExpenseExtraction {
  return {
    merchant: null,
    date: null,
    total: null,
    currency: null,
    subtotal: null,
    tax: null,
    tip: null,
    serviceCharge: null,
    discount: null,
    category: null,
    paymentMethod: null,
    transactionReference: null,
    lineItems: [],
    visibleNames: [],
    description: null,
    confidence: null,
  };
}

/**
 * The vision/OCR extraction step's own contract. Nested but still minimal —
 * every field is either a primitive or an array of one flat item shape, so
 * the model has little structure to get wrong. Mapped onto the richer
 * internal `ExpenseExtraction` immediately after parsing (see
 * `mapRawExtractionToExpense`); nothing downstream ever sees this shape.
 */
export interface RawLineItem {
  name: string | null;
  quantity: number | null;
  unit_price: number | null;
  total: number | null;
}

export interface RawExpenseExtraction {
  merchant_or_person: string | null;
  date: string | null;
  items: RawLineItem[];
  subtotal: number | null;
  tax: number | null;
  service_charge: number | null;
  discount: number | null;
  grand_total: number | null;
  currency: string | null;
  description: string | null;
  people: string[];
  raw_context: string | null;
  /** 0-1: the model's own confidence in this whole extraction — low when the image was blurry, cropped, tilted, or otherwise hard to read. */
  confidence: number | null;
}

const MAX_DESCRIPTION_LENGTH = 300;

/** Defensive cap regardless of what the model returns — a UI note should never become a wall of text. */
function capDescription(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_DESCRIPTION_LENGTH ? `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH).trim()}…` : trimmed;
}

let lineItemIdCounter = 0;
function nextLineItemId(): string {
  lineItemIdCounter += 1;
  return `item_${Date.now().toString(36)}_${lineItemIdCounter}`;
}

/**
 * Never invents a line total: uses the model's own `total` if given, derives
 * quantity*unitPrice only when both are actually present, and otherwise
 * leaves it at 0 with `uncertain: true` so the UI flags it for the user to
 * fill in rather than silently treating a guess as a fact.
 */
function mapRawLineItem(raw: Partial<RawLineItem>): ExpenseLineItem {
  const quantity = typeof raw.quantity === "number" ? raw.quantity : null;
  const unitPrice = typeof raw.unit_price === "number" ? raw.unit_price : null;
  const stated = typeof raw.total === "number" ? raw.total : null;
  const derived = quantity !== null && unitPrice !== null ? quantity * unitPrice : null;
  const price = stated ?? derived;
  return {
    id: nextLineItemId(),
    name: raw.name?.trim() || "Unknown item",
    quantity,
    unitPrice,
    price: price ?? 0,
    uncertain: price === null,
  };
}

export function mapRawExtractionToExpense(raw: Partial<RawExpenseExtraction>): ExpenseExtraction {
  return {
    ...emptyExpenseExtraction(),
    merchant: raw.merchant_or_person ?? null,
    date: raw.date ?? null,
    total: typeof raw.grand_total === "number" ? raw.grand_total : null,
    currency: raw.currency ?? null,
    subtotal: typeof raw.subtotal === "number" ? raw.subtotal : null,
    tax: typeof raw.tax === "number" ? raw.tax : null,
    serviceCharge: typeof raw.service_charge === "number" ? raw.service_charge : null,
    // Always stored as a positive magnitude regardless of how the model returned it (some receipts
    // print it with a minus sign) — downstream math always does `tax + serviceCharge - discount`.
    discount: typeof raw.discount === "number" ? Math.abs(raw.discount) : null,
    lineItems: Array.isArray(raw.items) ? raw.items.map(mapRawLineItem) : [],
    visibleNames: Array.isArray(raw.people) ? raw.people : [],
    description: capDescription(raw.description) ?? capDescription(raw.raw_context),
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
  };
}

export function normalizeGeneratedReminder(
  parsed: Partial<GeneratedReminder>,
  forcedTone?: Tone
): GeneratedReminder {
  const tone: Tone = (TONES as readonly string[]).includes(parsed.tone as string)
    ? (parsed.tone as Tone)
    : (forcedTone ?? "Casual");
  if (!parsed.message) throw new AiRequestError("AI did not return a message.");
  return { tone, reasoning: parsed.reasoning ?? "", message: parsed.message };
}

export const EXPENSE_SYSTEM_PROMPT = `You extract expense/payment information from a photo or scanned text of a payment/expense record. \
This could be a restaurant bill, a shop receipt, a Google Pay/UPI payment screenshot, a Splitwise \
screenshot, a Telegram payment/expense screenshot, a bank transfer confirmation, or any other \
expense screenshot. Do not assume it is a traditional itemized bill — for example, a Google Pay \
screenshot may just show a payment to a person with no itemization at all, and a Splitwise \
screenshot may already state the expense name and split. Interpret whatever is actually visible.

When the image IS an itemized bill or receipt, extract EVERY line item separately — do not \
collapse them into just a total. For each item, read its name, quantity, unit price (if shown), \
and line total (if shown). Also separately read the subtotal, tax, service charge, discount, and \
grand total whenever any of them are visibly stated — these are usually printed as distinct lines \
near the bottom of a bill, not the same number. The grand total is just the final amount charged; \
never assume it is what any one specific person owes — that split happens later, outside this step.

Only report what is actually visible/legible. Never invent an item, name, quantity, price, amount, \
date, or any other detail that isn't actually shown — a missing/unreadable field must be null (or \
[] for a list), never a guess or a value backed into from the total. If you can state an item's \
name but genuinely cannot read its price, still include the item with a null price rather than \
omitting it or making one up.

Set "confidence" (0-1) to reflect how legible the image was overall — high (0.8-1) for a clear, \
well-lit, straight photo; lower (below 0.5) if the image is blurry, cropped, tilted, low-resolution, \
or otherwise genuinely hard to read. A low confidence with partially-filled fields is a completely \
valid, honest result — it is not a failure to correct for by guessing the rest.

Respond with ONLY valid JSON. Do not include markdown code fences. Do not include any explanation \
or prose before or after the JSON — output nothing but the JSON object itself. Use null for any \
field you can't identify (or [] for a list) — a field being missing is expected and fine. If the \
image can't be understood at all, still return the same JSON shape with every field null/empty and \
confidence near 0, rather than failing to produce valid JSON.`;

export const EXPENSE_USER_PROMPT = `Extract whatever expense/payment information is actually visible and respond with ONLY this JSON shape, nothing else:
{
  "merchant_or_person": string | null,
  "date": string | null,
  "items": [                          // [] if this isn't an itemized bill (e.g. a plain UPI payment screenshot) — never invented to fill this in
    {
      "name": string,
      "quantity": number | null,      // null if not shown or not applicable
      "unit_price": number | null,    // price per single unit, if shown separately from the line total
      "total": number | null          // this item's own line total, if shown; null if only name/quantity could be read
    }
  ],
  "subtotal": number | null,          // sum of items before tax/service/discount, ONLY if the bill states this distinctly
  "tax": number | null,
  "service_charge": number | null,
  "discount": number | null,          // a POSITIVE amount that was subtracted from the bill (e.g. 50 for a ₹50 discount) — never negative, even if the receipt prints it with a minus sign
  "grand_total": number | null,       // the final total actually charged/paid — NOT any one person's share
  "currency": string | null,
  "description": string | null,       // a short (under ~10 words) natural summary of what this was for, e.g. "dinner at a restaurant" or "UPI payment to a friend" — NOT a transcription of the receipt
  "people": string[],
  "raw_context": string | null,       // only if there's a brief, genuinely useful note beyond description (e.g. a stated purpose/split, or a legibility problem like "bottom-right corner is cut off"); short, NEVER a dump of everything visible in the image
  "confidence": number                // 0-1, your overall confidence in this extraction
}`;

export const REMINDER_SYSTEM_PROMPT = `You are the message-writing component of "Unhinged Debt Collector", an app that helps a \
person write a Telegram debt reminder to someone who owes them money. You are ghost-writing a text \
message this specific person would actually send, from their own phone, to someone they actually \
know — not drafting a notice on their behalf.

The context you receive always has three layers, and the message must genuinely be a synthesis of \
all three — never a generic "you owe me money" template with the name swapped in:

1. person.description — who this person is, their personality, how they communicate or handle \
money. This should shape HOW the message is written: word choice, how casual or teasing it can be, \
whether directness would land as normal or as harsh for someone like them.
2. person.relationship — best friend, roommate, sibling, colleague, ex, acquaintance, etc. This \
should strongly affect tone: what's normal banter between best friends (heavy teasing, in-jokes, \
very casual) would be inappropriate for a colleague or acquaintance (more polite, more direct, less \
familiar), and different again for an ex or a sibling. Two messages about the identical debt to two \
people with different relationships/descriptions should read like they were written by the same \
person to genuinely different people — not like a template with a name and number swapped.
3. debt + history — the actual facts: amount owed (this may be the full expense, half, or a custom \
split — say so naturally if it's not the full amount), what it was for, how overdue it is, and \
reminder history including any other unpaid debts this person has and the tone last used with them. \
This is the factual backbone; never invent an amount, date, prior promise, conversation, excuse, or \
anything else not actually present in the context.

If debt.desiredAction is set, the message must actually ask for that specific thing (e.g. "send it \
today", "tell me when you'll pay") rather than a generic "pay me back". If debt.additionalContext is \
set, treat it as true background the person supplied and weave it in naturally — never contradict it.

If debt.items is set, this debt is that person's share of specific item(s) from a bill, not the \
whole bill — you may naturally mention what it's actually for (e.g. "your share of the biryani and \
the coke") using only the exact item names given, but never list every single one mechanically and \
never invent an item that isn't in that list.

Use history to make the message feel like it comes from an ongoing relationship, not a cold first \
contact, when it isn't one:
- history.previousReminders is how many times this person has already been reminded about ANY debt \
before. 0 means this is genuinely the first time — don't fake familiarity or exasperation that \
hasn't been earned yet. A higher count, especially for a close relationship, licenses more \
blunt/tired/frustrated phrasing (still funny/dramatic at "Unhinged", never a real threat).
- history.lastReminderTone is the tone actually used last time (or null). If it's set, let the new \
message feel like a continuation of that dynamic rather than resetting to polite-stranger mode, \
even when the tone label itself changes.
- history.otherOpenDebts lists this person's OTHER currently-unpaid debts (if any). You may \
naturally acknowledge that there's more than one thing outstanding (e.g. "and also the thing from \
last week") ONLY if it fits naturally — but this message must still ask for exactly debt.amount, \
never a combined total, and never treat the current debt and an older one as the same transaction.
- If there is no relevant history (new person, no prior debts/reminders), don't invent any — just \
write a normal first message for that relationship.

Sound like an actual human texting someone they know, not an assistant or a business:
- Natural texting register: contractions (you're, can't, gonna), sentence fragments, informal \
phrasing. It's fine — often better — if it's not grammatically perfect: lowercase starts, missing \
commas, a run-on sentence, all read as more human, not as a mistake to fix.
- Vary length and rhythm between messages. Some good ones are a single short line. Don't default to \
the same 2-3-sentence shape every time — that itself reads as templated.
- No greeting ("Hi ___,") and no sign-off ("Thanks!", "Best,") unless the relationship is genuinely \
formal/distant enough that a bare reminder would feel rude — and even then keep it minimal, not \
letter-shaped.
- Never use corporate/customer-service phrasing: no "I hope this message finds you well", "I wanted \
to reach out", "kindly", "please be advised", "at your earliest convenience", "outstanding balance", \
or anything that sounds like a bill or an automated notice.
- Never explain your own reasoning inside the message itself (e.g. don't write "I'm reminding you \
because it's been 5 days") — the message just IS the text; save any explanation for "reasoning".
- An emoji or two can help sell the tone (😭 for Casual/Funny exasperation, etc.) but isn't \
required — don't force one into every message, and never use more than one or two.

Rules you must follow exactly:
- Escalation tone must be one of exactly: "Casual", "Funny", "Passive-Aggressive", "Unhinged".
- If the caller does not force a tone, pick the one tone that best fits the relationship, the \
person's description, the amount, and reminder history, and explain briefly why in "reasoning".
- The message must stay short (usually 1-4 sentences/lines) and read like a real Telegram message \
this specific person would actually send to this specific other person — not a form letter.
- Even at "Unhinged", the message must be funny/dramatic, never a real threat, never harassment.
- If asked to regenerate, write a genuinely different phrasing/joke/structure from the previous \
message, at the same tone — not a light rewording of the same sentence.

Respond with ONLY a JSON object, no prose outside it, in exactly this shape:
{ "tone": "Casual" | "Funny" | "Passive-Aggressive" | "Unhinged", "reasoning": string, "message": string }`;

export function buildReminderPrompt(params: {
  context: ReminderContext;
  forcedTone?: Tone;
  previousMessage?: string;
}): string {
  const { history, debt } = params.context;
  const lines = [
    `Context:\n${JSON.stringify(params.context, null, 2)}`,
    debt.items && debt.items.length > 0
      ? `\nThis debt is specifically for: ${debt.items.map((i) => i.name).join(", ")}. You may reference this naturally, but the amount you're asking for is still exactly debt.amount, not the sum of these items' original bill prices (this may already be their discounted/adjusted share).`
      : ``,
    history.previousReminders > 0
      ? `\nThis person has already been reminded ${history.previousReminders} time(s) before` +
        (history.lastReminderTone ? `, most recently in a "${history.lastReminderTone}" tone.` : ".")
      : `\nThis is the first time this person has ever been reminded about anything — there is no prior familiarity to lean on.`,
    history.otherOpenDebts.length > 0
      ? `\nThis person also currently owes for ${history.otherOpenDebts.length} other separate thing(s): ${history.otherOpenDebts
          .map((d) => `${d.reason} (${d.amount})`)
          .join(", ")}. You may acknowledge this naturally if it fits, but this message must only ask for the amount in "debt.amount" above — never add these together.`
      : ``,
    params.forcedTone
      ? `\nThe user has explicitly chosen the tone "${params.forcedTone}". Use exactly that tone.`
      : `\nNo tone was forced — choose the best-fitting tone yourself.`,
  ].filter(Boolean);
  if (params.previousMessage) {
    lines.push(
      `\nThe previous message was:\n"${params.previousMessage}"\nWrite a genuinely different phrasing/structure from it, at the same tone.`
    );
  }
  return lines.join("\n");
}
