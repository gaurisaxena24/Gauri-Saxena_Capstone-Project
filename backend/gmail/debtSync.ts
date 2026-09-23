/**
 * User-initiated, single-debt-scoped Gmail check (the "Sync" button — see
 * backend/api/routes/debts.ts's POST /:debtId/sync). Given one already-refreshed access token and
 * one specific debt+person, searches a bounded window of the user's own Gmail for a payment email
 * that matches THIS debt on all three signals:
 *
 *   1. person/name — the payer in the email is this debt's person (AI judgment, allows "Raj K."),
 *   2. date        — the email arrived within the window around the expense date (checked in code
 *                    against Gmail's own internalDate, not just the search query),
 *   3. exact amount — the amount received equals the debt amount (checked in code, not by the AI).
 *
 * Only a candidate passing all three is returned as PAYMENT_FOUND — the /sync route then marks the
 * debt paid immediately via agent/debtCollectorAgent.ts's markDebtPaid. Anything less is
 * NO_PAYMENT_FOUND and the debt stays unpaid. Stops at the first full match, so the status changes
 * as soon as a matching email is found rather than after reading every candidate.
 *
 * Deliberately separate from backend/gmail/paymentScanner.ts, the *background* scanner. The
 * low-level Gmail list/fetch primitives below intentionally mirror paymentScanner.ts's (same Gmail
 * REST endpoints, same base64url/HTML-stripped body extraction) rather than importing from it —
 * kept deliberately separate so this user-initiated feature can never change the background
 * scanner's behavior by editing a function it also depends on.
 */

import { extractDebtSyncCandidate } from "../ai/debtSyncReader.js";
import {
  isGmailEmailMatchedToOtherDebt,
  type DebtGmailSyncStatus,
  type ExpenseDebt,
  type Person,
} from "../database/database.js";

/** Bounded and cheap — this is a targeted single-debt check, not a broad scan. */
const MAX_CANDIDATE_MESSAGES = 12;

/**
 * The date signal: a matching payment email must arrive no earlier than 1 day before the expense
 * date (slack for timezones / an expense entered with the wrong day) and no later than 7 days after
 * it (someone paying back a few days later). Chosen as a reasonable default, not derived from any
 * measured data.
 */
const DATE_WINDOW_DAYS_BEFORE = 1;
const DATE_WINDOW_DAYS_AFTER = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Amounts are compared exactly — this only absorbs floating-point noise (850 vs 850.0000001),
 * never a real difference like ₹850 vs ₹851. */
const AMOUNT_EPSILON = 0.005;

const PAYMENT_LANGUAGE_QUERY =
  '(paid OR payment OR received OR credited OR transferred OR sent OR settled OR transaction OR UPI OR "bank transfer" OR "payment successful")';

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

/** The window a matching email must fall inside, anchored on the expense date (or, when the expense
 * has no usable date, the day the debt was created). Null only if neither parses. */
function buildDateWindow(anchorIso: string): DateWindow | null {
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) return null;
  // Anchored on the start of that day so a date-only "2026-09-20" and a full timestamp behave alike.
  const dayStart = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  return {
    startMs: dayStart - DATE_WINDOW_DAYS_BEFORE * DAY_MS,
    endMs: dayStart + (DATE_WINDOW_DAYS_AFTER + 1) * DAY_MS,
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

/**
 * Runs one targeted Gmail check for one debt. `accessToken` must already be a valid, freshly
 * refreshed Gmail access token (see backend/api/routes/gmail.ts's refreshAccessToken, called by the
 * route before this). Never throws for an individual candidate failing to fetch/classify — those are
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
  const window = buildDateWindow(expenseDate ?? debt.created_at);
  if (!window) return noMatchResult("This expense has no usable date to match a payment email against.");

  const query = `${buildDateWindowQuery(window)} ${PAYMENT_LANGUAGE_QUERY}`;
  const candidates = await listCandidateMessages(accessToken, query);

  for (const { id: messageId } of candidates) {
    try {
      const message = await fetchMessage(accessToken, messageId);

      // Signal 2 (date) — checked first since it's free, before spending an AI call on this email.
      if (message.receivedAtMs == null || message.receivedAtMs < window.startMs || message.receivedAtMs >= window.endMs) {
        continue;
      }

      const extraction = await extractDebtSyncCandidate({
        personName: person.name,
        personUsername: person.telegram_username,
        personPhone: person.phone_number,
        emailSubject: message.subject,
        emailBody: message.bodyText,
      });
      if (extraction.extractionFailed || !extraction.isIncomingPayment) continue;

      // Signal 3 (exact amount) — compared here, never left to the model.
      if (extraction.amount == null || Math.abs(extraction.amount - debt.amount) > AMOUNT_EPSILON) continue;

      // Signal 1 (person/name).
      if (!extraction.payer || !extraction.payerMatchesPerson) continue;

      // One payment email only ever settles one debt — if it already marked a different debt paid
      // (e.g. the same person owes the same amount twice that week), keep looking for another email.
      if (await isGmailEmailMatchedToOtherDebt(userId, message.id, debt.id)) continue;

      return {
        status: "PAYMENT_FOUND",
        confidence: 1,
        reason: extraction.reason || `Payment of ${debt.amount} from ${extraction.payer} matches name, date and amount.`,
        emailId: message.id,
        emailDate: message.date || null,
        sender: message.from || null,
        subject: message.subject || null,
      };
    } catch (error) {
      console.error(`[debt-sync] Failed to fetch/classify Gmail message ${messageId} for debt ${debt.id}:`, error);
      // Isolated — one bad candidate email must never abort the rest of this debt's sync.
    }
  }

  return noMatchResult();
}
