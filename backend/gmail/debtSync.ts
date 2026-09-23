/**
 * User-initiated, single-debt-scoped Gmail check (the "Sync" button — see
 * backend/api/routes/debts.ts's POST /:debtId/sync). Given one already-refreshed access token and
 * one specific debt+person, searches a bounded window of the user's own Gmail for messages that
 * could be evidence THIS debt was paid, and asks the AI to judge each one against that specific
 * target (see backend/ai/debtSyncReader.ts). Returns a single best result; never changes the debt's
 * status itself — see agent/debtCollectorAgent.ts's markDebtPaid for the only place that happens.
 *
 * Deliberately separate from backend/gmail/paymentScanner.ts, the *background* scanner: that file
 * decides *when* to auto-mark a debt paid across ALL of a user's unpaid debts on a timer. This file
 * only ever looks at one debt, only when a user explicitly clicks Sync, and never auto-marks
 * anything paid. The low-level Gmail list/fetch primitives below intentionally mirror
 * paymentScanner.ts's (same Gmail REST endpoints, same base64url/HTML-stripped body extraction)
 * rather than importing from it — kept deliberately separate so this new, user-initiated feature can
 * never change the existing background scanner's behavior by editing a function it also depends on.
 */

import { classifyDebtSyncCandidate } from "../ai/debtSyncReader.js";
import type { DebtGmailSyncStatus, ExpenseDebt, Person } from "../database/database.js";

/** Bounded and cheap — this is a targeted single-debt check, not a broad scan. */
const MAX_CANDIDATE_MESSAGES = 12;

/**
 * How far around the expense's own date to search. Payments are rarely instant (someone might pay
 * days later), but an unbounded date range would both pull in a lot of unrelated mail and cost an AI
 * call per candidate for no benefit — 7 days each side is generous enough to catch a delayed payment
 * while keeping the candidate list small. Chosen as a reasonable default, not derived from any
 * measured data; the search still uses payment-language keywords too, not date alone.
 */
const DATE_WINDOW_DAYS = 7;

const PAYMENT_LANGUAGE_QUERY =
  '(paid OR payment OR transferred OR sent OR settled OR cleared OR transaction OR UPI OR "bank transfer" OR "payment successful")';

/** A classification is only ever surfaced as a strong PAYMENT_FOUND at this confidence or above;
 * below it (but still relevant) it's reported as POSSIBLE_PAYMENT instead. Below MIN_CONFIDENCE it's
 * treated as no usable signal from that candidate at all. Deliberately conservative — a wrong
 * PAYMENT_FOUND is worse than showing POSSIBLE_PAYMENT and letting the user decide. */
const FOUND_CONFIDENCE_THRESHOLD = 0.75;
const MIN_CONFIDENCE = 0.35;

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
  return {
    id: message.id,
    subject: header("subject"),
    from: header("from"),
    date: header("date"),
    bodyText: bodyText.slice(0, 4000), // bounded — classification doesn't need a whole email chain
  };
}

/** Gmail's search syntax only supports day-granularity `after:`/`before:` (both in the form
 * YYYY/MM/DD, `before:` exclusive of that day) — this is the closest a Gmail query can get to "the
 * expense date, plus a window either side". Returns "" (no date filter) if the expense has no usable
 * date, rather than silently searching nothing. */
function buildDateWindowQuery(expenseDateIso: string | null): string {
  if (!expenseDateIso) return "";
  const date = new Date(expenseDateIso);
  if (Number.isNaN(date.getTime())) return "";
  const after = new Date(date);
  after.setDate(after.getDate() - DATE_WINDOW_DAYS);
  const before = new Date(date);
  before.setDate(before.getDate() + DATE_WINDOW_DAYS + 1);
  const fmt = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `after:${fmt(after)} before:${fmt(before)}`;
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

function noMatchResult(): DebtSyncResult {
  return { status: "NO_PAYMENT_FOUND", confidence: null, reason: null, emailId: null, emailDate: null, sender: null, subject: null };
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
  debt: ExpenseDebt;
  person: Person;
  expenseDate: string | null;
}): Promise<DebtSyncResult> {
  const { accessToken, debt, person, expenseDate } = params;
  const query = [buildDateWindowQuery(expenseDate), PAYMENT_LANGUAGE_QUERY].filter(Boolean).join(" ");

  const candidates = await listCandidateMessages(accessToken, query);

  let best: { confidence: number; reason: string; message: FetchedMessage } | null = null;

  for (const { id: messageId } of candidates) {
    try {
      const message = await fetchMessage(accessToken, messageId);
      const classification = await classifyDebtSyncCandidate({
        personName: person.name,
        personUsername: person.telegram_username,
        personPhone: person.phone_number,
        amount: debt.amount,
        currency: debt.currency,
        expenseDate,
        emailSubject: message.subject,
        emailBody: message.bodyText,
      });

      if (classification.extractionFailed) continue;
      if (classification.status === "NO_PAYMENT_FOUND") continue;
      if (classification.confidence < MIN_CONFIDENCE) continue;

      if (!best || classification.confidence > best.confidence) {
        best = { confidence: classification.confidence, reason: classification.reason, message };
      }
    } catch (error) {
      console.error(`[debt-sync] Failed to fetch/classify Gmail message ${messageId} for debt ${debt.id}:`, error);
      // Isolated — one bad candidate email must never abort the rest of this debt's sync.
    }
  }

  if (!best) return noMatchResult();

  const status: DebtGmailSyncStatus = best.confidence >= FOUND_CONFIDENCE_THRESHOLD ? "PAYMENT_FOUND" : "POSSIBLE_PAYMENT";
  return {
    status,
    confidence: best.confidence,
    reason: best.reason || null,
    emailId: best.message.id,
    emailDate: best.message.date || null,
    sender: best.message.from || null,
    subject: best.message.subject || null,
  };
}
