/**
 * User-initiated, single-debt-scoped Gmail check (the "Sync" button — see
 * backend/api/routes/debts.ts's POST /:debtId/sync). Given one already-refreshed access token and
 * one specific debt+person, searches a bounded window of the user's own Gmail for a payment email
 * that matches THIS debt on all three signals:
 *
 *   1. person/name — the payer in the email is this debt's person ("Raj K.", "rajkumar@okaxis" and a
 *                    masked phone ending in the same digits all count),
 *   2. date        — the email arrived inside the debt's date window (checked in code against
 *                    Gmail's own internalDate, not just the search query),
 *   3. exact amount — an amount stated in the email equals the debt amount exactly.
 *
 * Emails are read by backend/gmail/paymentEmailParser.ts first — plain code, no AI — so a Sync is
 * instant and keeps working when the AI provider is rate-limited. Only if no email matches that way
 * are the remaining in-window emails handed to the AI reader (backend/ai/debtSyncReader.ts) as a
 * fallback for unusual formats; its answer is still checked against the same three signals in code.
 *
 * Only a full match is returned as PAYMENT_FOUND — the /sync route then marks the debt paid
 * immediately via agent/debtCollectorAgent.ts's markDebtPaid. Anything less is NO_PAYMENT_FOUND and
 * the debt stays unpaid.
 *
 * Deliberately separate from backend/gmail/paymentScanner.ts, the *background* scanner. The
 * low-level Gmail list/fetch primitives below intentionally mirror paymentScanner.ts's (same Gmail
 * REST endpoints, same base64url/HTML-stripped body extraction) rather than importing from it —
 * kept deliberately separate so this user-initiated feature can never change the background
 * scanner's behavior by editing a function it also depends on.
 */

import { extractDebtSyncCandidate } from "../ai/debtSyncReader.js";
import { parsePaymentEmail } from "./paymentEmailParser.js";
import {
  isGmailEmailMatchedToOtherDebt,
  type DebtGmailSyncStatus,
  type ExpenseDebt,
  type Person,
} from "../database/database.js";

/** Bounded and cheap — this is a targeted single-debt check, not a broad scan. All candidates are
 * fetched in parallel, so this costs one round trip, not 25. */
const MAX_CANDIDATE_MESSAGES = 25;

/** At most this many in-window emails go to the (slow, rate-limited) AI fallback. */
const MAX_AI_FALLBACK_MESSAGES = 5;

/**
 * The date signal. A matching payment email must arrive no earlier than 1 day before the debt's
 * earliest date (slack for timezones) and no later than 14 days after its latest date. The debt's
 * dates are the expense date AND the day the debt was created — so a receipt dated weeks ago that
 * was only entered (and asked about) today still matches a payment made today. Chosen as reasonable
 * defaults, not derived from any measured data.
 */
const DATE_WINDOW_DAYS_BEFORE = 1;
const DATE_WINDOW_DAYS_AFTER = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Amounts are compared exactly — this only absorbs floating-point noise (850 vs 850.0000001),
 * never a real difference like ₹850 vs ₹851. */
const AMOUNT_EPSILON = 0.005;

const PAYMENT_LANGUAGE_TERMS = [
  "paid", "payment", "received", "credited", "transferred", "sent", "settled", "repaid", "returned",
  "transaction", "UPI", '"bank transfer"', '"payment successful"',
];

interface GmailMessageListItem {
  id: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  /** Epoch milliseconds (as a string) when Gmail received the message — used for the date signal. */
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    mimeType?: string;
    parts?: GmailMessagePart[];
  };
}

async function listCandidateMessages(accessToken: string, query: string): Promise<GmailMessageListItem[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(MAX_CANDIDATE_MESSAGES));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail messages.list failed (${res.status})`);
  const body = await res.json();
  return body.messages ?? [];
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Depth-first search for the first text/plain part, falling back to text/html (crudely stripped of
 * tags) — same approach as paymentScanner.ts's extractBodyText, kept as its own copy (see file doc
 * comment above for why). */
function extractBodyText(part: GmailMessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  if (part.parts) {
    for (const child of part.parts) {
      const text = extractBodyText(child);
      if (text) return text;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ");
  }
  return "";
}

interface FetchedMessage {
  id: string;
  subject: string;
  bodyText: string;
  from: string;
  date: string;
  receivedAtMs: number | null;
}

async function fetchMessage(accessToken: string, messageId: string): Promise<FetchedMessage> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Gmail messages.get failed (${res.status})`);
  const message: GmailMessage = await res.json();
  const header = (name: string) =>
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const bodyText =
    (message.payload?.body?.data ? decodeBase64Url(message.payload.body.data) : "") ||
    extractBodyText(message.payload as GmailMessagePart | undefined);
  const internalDate = Number(message.internalDate);
  return {
    id: message.id,
    subject: header("subject"),
    from: header("from"),
    date: header("date"),
    receivedAtMs: Number.isFinite(internalDate) && internalDate > 0 ? internalDate : null,
    bodyText: bodyText.slice(0, 4000), // bounded — classification doesn't need a whole email chain
  };
}

interface DateWindow {
  startMs: number;
  endMs: number;
}

function dayStartMs(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Start of that day, so a date-only "2026-09-20" and a full timestamp behave alike.
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The window a matching email must fall inside — spans from the earliest of the expense date / debt
 * creation day to the latest of them (plus slack either side). Null only if neither parses. */
function buildDateWindow(expenseDate: string | null, debtCreatedAt: string): DateWindow | null {
  const anchors = [dayStartMs(expenseDate), dayStartMs(debtCreatedAt)].filter((n): n is number => n != null);
  if (anchors.length === 0) return null;
  return {
    startMs: Math.min(...anchors) - DATE_WINDOW_DAYS_BEFORE * DAY_MS,
    endMs: Math.max(...anchors) + (DATE_WINDOW_DAYS_AFTER + 1) * DAY_MS,
  };
}

/** Gmail's search syntax only supports day-granularity `after:`/`before:` (YYYY/MM/DD, `before:`
 * exclusive) — padded by a day each side so the search never drops an email the exact
 * receivedAtMs check below would accept. */
function buildDateWindowQuery(window: DateWindow): string {
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  return `after:${fmt(window.startMs - DAY_MS)} before:${fmt(window.endMs + DAY_MS)}`;
}

/** Payment words OR any part of the person's name — so a plain "here's the 850 I owe you" from Raj,
 * with no payment keyword at all, is still a candidate. */
function buildSearchTerms(person: Person): string {
  const nameParts = person.name
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((p) => p.length >= 3);
  return `(${[...PAYMENT_LANGUAGE_TERMS, ...nameParts.map((p) => `"${p}"`)].join(" OR ")})`;
}

export interface DebtSyncResult {
  status: DebtGmailSyncStatus;
  confidence: number | null;
  reason: string | null;
  emailId: string | null;
  emailDate: string | null;
  sender: string | null;
  subject: string | null;
}

function noMatchResult(reason: string | null = null): DebtSyncResult {
  return { status: "NO_PAYMENT_FOUND", confidence: null, reason, emailId: null, emailDate: null, sender: null, subject: null };
}

function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_EPSILON;
}

function foundResult(message: FetchedMessage, reason: string): DebtSyncResult {
  return {
    status: "PAYMENT_FOUND",
    confidence: 1,
    reason,
    emailId: message.id,
    emailDate: message.date || null,
    sender: message.from || null,
    subject: message.subject || null,
  };
}

/**
 * Runs one targeted Gmail check for one debt. `accessToken` must already be a valid, freshly
 * refreshed Gmail access token (see backend/api/routes/gmail.ts's refreshAccessToken, called by the
 * route before this). Never throws for an individual candidate failing to fetch/read — those are
 * logged and skipped so one bad message never aborts the whole sync; a genuinely fatal problem (the
 * initial messages.list call failing, e.g. a Gmail API outage or rate limit) does throw, and the
 * caller (the /sync route) is responsible for turning that into a SYNC_ERROR response.
 */
export async function syncDebtAgainstGmail(params: {
  accessToken: string;
  userId: number;
  debt: ExpenseDebt;
  person: Person;
  expenseDate: string | null;
}): Promise<DebtSyncResult> {
  const { accessToken, userId, debt, person, expenseDate } = params;
  const window = buildDateWindow(expenseDate, debt.created_at);
  if (!window) return noMatchResult("This debt has no usable date to match a payment email against.");

  const query = `${buildDateWindowQuery(window)} ${buildSearchTerms(person)}`;
  const candidates = await listCandidateMessages(accessToken, query);

  // All fetched at once (Gmail returns newest first, and that order is kept).
  const fetched = await Promise.all(
    candidates.map(({ id }) =>
      fetchMessage(accessToken, id).catch((error) => {
        console.error(`[debt-sync] Failed to fetch Gmail message ${id} for debt ${debt.id}:`, error);
        return null;
      })
    )
  );

  // Signal 2 (date) — the exact check against when Gmail actually received each email.
  const inWindow = fetched.filter(
    (m): m is FetchedMessage =>
      m != null && m.receivedAtMs != null && m.receivedAtMs >= window.startMs && m.receivedAtMs < window.endMs
  );

  const paymentPerson = {
    name: person.name,
    telegramUsername: person.telegram_username,
    phoneNumber: person.phone_number,
  };

  // Pass 1 — instant, no AI.
  const unresolved: FetchedMessage[] = [];
  for (const message of inWindow) {
    const parsed = parsePaymentEmail(message, paymentPerson);
    const amountMatches = parsed.amounts.some((a) => amountsEqual(a, debt.amount));
    if (parsed.isIncomingPayment && amountMatches && parsed.personMatch) {
      if (await isGmailEmailMatchedToOtherDebt(userId, message.id, debt.id)) continue;
      return foundResult(
        message,
        `Payment email matches ${person.name} (${parsed.personMatch}), the date, and the exact amount ${debt.amount}.`
      );
    }
    // Only emails that at least look payment-ish are worth an AI call.
    if (parsed.isIncomingPayment || amountMatches || parsed.personMatch) unresolved.push(message);
  }

  // Pass 2 — AI fallback for formats the parser couldn't read. Its answer is still held to the same
  // three signals in code; if the AI is unavailable (e.g. rate-limited) these emails are just skipped.
  for (const message of unresolved.slice(0, MAX_AI_FALLBACK_MESSAGES)) {
    try {
      const extraction = await extractDebtSyncCandidate({
        personName: person.name,
        personUsername: person.telegram_username,
        personPhone: person.phone_number,
        emailSubject: message.subject,
        emailBody: message.bodyText,
      });
      if (extraction.extractionFailed || !extraction.isIncomingPayment) continue;
      if (extraction.amount == null || !amountsEqual(extraction.amount, debt.amount)) continue;
      if (!extraction.payer || !extraction.payerMatchesPerson) continue;
      if (await isGmailEmailMatchedToOtherDebt(userId, message.id, debt.id)) continue;
      return foundResult(
        message,
        extraction.reason || `Payment of ${debt.amount} from ${extraction.payer} matches name, date and amount.`
      );
    } catch (error) {
      console.error(`[debt-sync] AI fallback failed for Gmail message ${message.id} (debt ${debt.id}):`, error);
    }
  }

  console.log(
    `[debt-sync] Debt ${debt.id}: ${candidates.length} candidate email(s), ${inWindow.length} in the date window, none matched name + date + amount ${debt.amount}.`
  );
  return noMatchResult();
}
