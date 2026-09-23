/**
 * Deterministic (no-AI) reader for payment emails, used by the per-debt Gmail Sync
 * (backend/gmail/debtSync.ts). Reads the three things Sync needs straight out of the email text —
 * is money arriving, which amounts are stated, and does the payer look like this debt's person —
 * so a Sync is instant and keeps working even when the AI provider is rate-limited or down. The AI
 * reader (backend/ai/debtSyncReader.ts) is only a fallback for emails this can't make sense of.
 *
 * Covers the common Indian payment-email shapes: UPI apps ("Raj Kumar paid you ₹850"), bank credit
 * alerts ("INR 850.00 credited to your a/c ... by VPA rajkumar@okaxis"), and plain person-written
 * emails ("hey, sent you 850 for dinner").
 */

export interface PaymentPerson {
  name: string;
  telegramUsername: string | null;
  phoneNumber: string | null;
}

export interface ParsedPaymentEmail {
  isIncomingPayment: boolean;
  /** Every amount stated in the email — currency-marked ones if any exist, otherwise bare numbers. */
  amounts: number[];
  /** What in the email matched the person (e.g. "raj kumar", "phone ••1234"), or null if nothing did. */
  personMatch: string | null;
}

/** Money clearly arriving to the reader — wins even if the email also mentions a debit (bank alerts
 * often say "debited from X, credited to you"). */
const STRONG_INCOMING =
  /\b(received|credited|paid you|sent you|transferred to you|payment from|money from|you got|you've got|you have got|deposited)\b/;
/** Money leaving the reader — a receipt for something they paid, not a repayment to them. */
const OUTGOING =
  /\b(debited|you paid|you sent|you have paid|you have sent|you've paid|you've sent|paid to|sent to|payment to|transferred to|withdrawn|purchase|order)\b/;
const GENERIC_PAYMENT = /\b(paid|sent|transferred|settled|cleared|payment|repaid|returned|upi|transaction)\b/;

const NUMBER = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const CURRENCY = String.raw`(?:₹|rs\.?|inr|rupees?|\$|usd|€|eur|£|gbp)`;
const CURRENCY_BEFORE = new RegExp(`${CURRENCY}\\s*${NUMBER}`, "gi");
const CURRENCY_AFTER = new RegExp(`${NUMBER}\\s*(?:${CURRENCY}|\\/-)`, "gi");
const BARE_NUMBER = new RegExp(`(?<![\\d.,])${NUMBER}(?![\\d,]|\\.\\d)`, "g");

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function collect(text: string, pattern: RegExp): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const n = toNumber(match[1]);
    if (n != null) out.push(n);
  }
  return out;
}

function extractAmounts(text: string): number[] {
  const marked = [...collect(text, CURRENCY_BEFORE), ...collect(text, CURRENCY_AFTER)];
  if (marked.length > 0) return marked;
  // No currency markers at all (e.g. "sent you 850 for dinner") — fall back to every standalone
  // number. Still safe: Sync also requires the person and the date to match, and the amount must
  // equal the debt exactly.
  return collect(text, BARE_NUMBER);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(haystack: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(word)}([^a-z0-9]|$)`).test(haystack);
}

function matchPerson(text: string, person: PaymentPerson): string | null {
  const name = person.name.trim().toLowerCase().replace(/\s+/g, " ");
  if (name && containsWord(text, name)) return name;

  // First name (or any name part of 3+ letters, e.g. a surname) as a whole word — UPI apps and
  // banks often shorten "Raj Kumar" to "Raj K." or "RAJ".
  const parts = name.split(" ").filter((p) => p.length >= 3);
  for (const part of parts) {
    if (containsWord(text, part)) return part;
  }
  // UPI IDs squash the name together: "rajkumar@okaxis", "raj.kumar@ybl".
  const squashed = name.replace(/[^a-z0-9]/g, "");
  if (squashed.length >= 4 && text.replace(/[._-]/g, "").includes(squashed)) return squashed;

  const username = person.telegramUsername?.trim().replace(/^@/, "").toLowerCase();
  if (username && username.length >= 3 && text.includes(username)) return `@${username}`;

  // Phone, possibly masked ("XXXXXX1234", "******1234") — the last 4 digits must be there.
  const digits = person.phoneNumber?.replace(/\D/g, "") ?? "";
  if (digits.length >= 4) {
    const last4 = digits.slice(-4);
    if (new RegExp(`(?:[x*•\\d]{2,}|\\+\\d+\\s?)${last4}(?!\\d)`).test(text)) return `phone ••${last4}`;
  }
  return null;
}

export function parsePaymentEmail(
  email: { subject: string; from: string; bodyText: string },
  person: PaymentPerson
): ParsedPaymentEmail {
  const text = `${email.subject}\n${email.from}\n${email.bodyText}`.toLowerCase().replace(/\s+/g, " ");
  const strongIncoming = STRONG_INCOMING.test(text);
  const isIncomingPayment = strongIncoming || (GENERIC_PAYMENT.test(text) && !OUTGOING.test(text));
  return {
    isIncomingPayment,
    amounts: extractAmounts(text),
    personMatch: matchPerson(text, person),
  };
}
