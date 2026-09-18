export interface ExpenseLineItem {
  name: string;
  price: number;
}

export interface ExpenseExtraction {
  merchant: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  tax: number | null;
  tip: number | null;
  category: string | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  lineItems: ExpenseLineItem[];
  visibleNames: string[];
  description: string | null;
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
  };
  history: {
    previousDebts: number;
    previousReminders: number;
    previousPaidDebts: number;
    daysOutstanding: number;
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
    tax: null,
    tip: null,
    category: null,
    paymentMethod: null,
    transactionReference: null,
    lineItems: [],
    visibleNames: [],
    description: null,
  };
}

/**
 * The vision/OCR extraction step's own contract — deliberately flat and
 * minimal (7 fields, no nested arrays-of-objects) so the model has as little
 * structure to get wrong as possible, keeping the JSON small and reliable to
 * generate. Mapped onto the richer internal `ExpenseExtraction` immediately
 * after parsing (see `mapRawExtractionToExpense`); nothing downstream ever
 * sees this shape.
 */
export interface RawExpenseExtraction {
  amount: number | null;
  currency: string | null;
  date: string | null;
  merchant_or_person: string | null;
  description: string | null;
  people: string[];
  raw_context: string | null;
}

export function mapRawExtractionToExpense(raw: Partial<RawExpenseExtraction>): ExpenseExtraction {
  return {
    ...emptyExpenseExtraction(),
    merchant: raw.merchant_or_person ?? null,
    date: raw.date ?? null,
    total: typeof raw.amount === "number" ? raw.amount : null,
    currency: raw.currency ?? null,
    visibleNames: Array.isArray(raw.people) ? raw.people : [],
    description: raw.description ?? raw.raw_context ?? null,
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

Only report what is actually visible/legible. Never invent an amount, name, date, or any other \
detail that isn't shown.

Respond with ONLY valid JSON. Do not include markdown code fences. Do not include any explanation \
or prose before or after the JSON — output nothing but the JSON object itself. Use null for any \
field you can't identify (or [] for the people list) — a field being missing is expected and fine. \
If the image can't be understood at all, still return the same JSON shape with every field null/empty \
rather than failing to produce valid JSON.`;

export const EXPENSE_USER_PROMPT = `Extract whatever expense/payment information is actually visible and respond with ONLY this JSON shape, nothing else:
{
  "amount": number | null,
  "currency": string | null,
  "date": string | null,
  "merchant_or_person": string | null,
  "description": string | null,
  "people": string[],
  "raw_context": string | null
}`;

export const REMINDER_SYSTEM_PROMPT = `You are the message-writing component of "Unhinged Debt Collector", an app that helps a \
person write a Telegram debt reminder to someone who owes them money.

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
3. debt — the actual facts: amount owed (this may be the full expense, half, or a custom split — \
say so naturally if it's not the full amount), what it was for, how overdue it is, and reminder \
history. This is the factual backbone; never invent an amount, date, prior promise, conversation, \
or excuse that isn't actually in the context.

If debt.desiredAction is set, the message must actually ask for that specific thing (e.g. "send it \
today", "tell me when you'll pay") rather than a generic "pay me back". If debt.additionalContext is \
set, treat it as true background the person supplied and weave it in naturally — never contradict it.

Rules you must follow exactly:
- Escalation tone must be one of exactly: "Casual", "Funny", "Passive-Aggressive", "Unhinged".
- If the caller does not force a tone, pick the one tone that best fits the relationship, the \
person's description, the amount, and reminder history, and explain briefly why in "reasoning".
- The message must stay short (2-4 sentences) and read like a real Telegram message this specific \
person would actually send to this specific other person — not a form letter.
- Even at "Unhinged", the message must be funny/dramatic, never a real threat, never harassment.
- If asked to regenerate, write a genuinely different phrasing/joke from the previous message, at the \
same tone.

Respond with ONLY a JSON object, no prose outside it, in exactly this shape:
{ "tone": "Casual" | "Funny" | "Passive-Aggressive" | "Unhinged", "reasoning": string, "message": string }`;

export function buildReminderPrompt(params: {
  context: ReminderContext;
  forcedTone?: Tone;
  previousMessage?: string;
}): string {
  const lines = [
    `Context:\n${JSON.stringify(params.context, null, 2)}`,
    params.forcedTone
      ? `\nThe user has explicitly chosen the tone "${params.forcedTone}". Use exactly that tone.`
      : `\nNo tone was forced — choose the best-fitting tone yourself.`,
  ];
  if (params.previousMessage) {
    lines.push(
      `\nThe previous message was:\n"${params.previousMessage}"\nWrite a different variation at the same tone.`
    );
  }
  return lines.join("\n");
}
