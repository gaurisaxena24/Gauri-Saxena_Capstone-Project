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
  };
  debt: {
    amount: number;
    currency: string;
    date: string | null;
    category: string | null;
    reason: string;
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

export function normalizeExpenseExtraction(parsed: Partial<ExpenseExtraction>): ExpenseExtraction {
  return {
    merchant: parsed.merchant ?? null,
    date: parsed.date ?? null,
    total: typeof parsed.total === "number" ? parsed.total : null,
    currency: parsed.currency ?? null,
    tax: typeof parsed.tax === "number" ? parsed.tax : null,
    tip: typeof parsed.tip === "number" ? parsed.tip : null,
    category: parsed.category ?? null,
    paymentMethod: parsed.paymentMethod ?? null,
    transactionReference: parsed.transactionReference ?? null,
    lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
    visibleNames: Array.isArray(parsed.visibleNames) ? parsed.visibleNames : [],
    description: parsed.description ?? null,
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

export const EXPENSE_SYSTEM_PROMPT =
  "You extract structured data from a photo or scanned text of a payment/expense record. This could " +
  "be a restaurant bill, a shop receipt, a Google Pay/UPI payment screenshot, a bank transfer " +
  "confirmation, a shopping receipt, or any other expense/payment screenshot — do not assume it is a " +
  "traditional itemized bill. Only report what is actually visible/legible. Never invent a merchant " +
  "name, date, amount, payment method, or item. If a field can't be determined, use null (or [] for " +
  "list fields).";

export const EXPENSE_USER_PROMPT = `Extract the expense/payment details and respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "merchant": string | null,        // who was paid / merchant name
  "date": string | null,            // as shown, or ISO 8601 if you can normalize it confidently
  "total": number | null,           // final amount, plain number, no currency symbol
  "currency": string | null,        // e.g. "INR", "USD", or the symbol actually shown
  "tax": number | null,
  "tip": number | null,
  "category": string | null,        // one short word: "food", "groceries", "transport", "utilities", "shopping", "travel", "rent", "other"
  "paymentMethod": string | null,   // e.g. "UPI", "Google Pay", "Cash", "Card", "Bank Transfer"
  "transactionReference": string | null,  // UPI ref / transaction ID if shown
  "lineItems": [{ "name": string, "price": number }],  // [] if this is a payment screenshot with no itemization
  "visibleNames": string[],         // any person names actually printed (e.g. payer/payee names); [] if none
  "description": string | null      // a short natural description if the source itself states a note/purpose
}`;

export const REMINDER_SYSTEM_PROMPT = `You are the message-writing component of "Unhinged Debt Collector", an app that helps a \
person write a Telegram reminder to a friend/roommate/coworker who owes them money.

Rules you must follow exactly:
- Use ONLY the facts given to you in the context JSON. Never invent an amount, date, prior promise, \
conversation, or excuse that isn't in the context.
- Escalation tone must be one of exactly: "Casual", "Funny", "Passive-Aggressive", "Unhinged".
- If the caller does not force a tone, pick the one tone that best fits the relationship, amount, \
and reminder history, and explain briefly why in "reasoning".
- The message must stay short (2-4 sentences), read like a real Telegram message from one person to \
a friend, and reference the actual debt details naturally.
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
