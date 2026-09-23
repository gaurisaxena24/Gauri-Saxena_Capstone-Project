/**
 * Background job: for one connected user, checks their Gmail inbox for payment-received emails and
 * marks a matching debt paid — reusing the app's existing mark-paid flow verbatim
 * (agent/debtCollectorAgent.ts's markDebtPaid), which already sends the thank-you message and
 * already stops future automatic reminders (backend/reminders/scheduler.ts only ever picks up
 * debts still UNPAID). This file's only job is deciding *when* to call it.
 *
 * Deliberately conservative: matches on amount against this user's own unpaid debts, and — only
 * when several debts share that amount (the common case for an evenly split group expense) — uses
 * whatever identified the payer (name, UPI ID, or phone number, even partially masked) to break the
 * tie against each candidate's saved name/username/phone (see resolveMatch below). Anything still
 * ambiguous, or with zero matches, is left alone for the user to reconcile manually — a wrong
 * auto-mark-paid would be worse than a missed one.
 */

import * as agent from "../../agent/debtCollectorAgent.js";
import * as profileAgent from "../../agent/profileAgent.js";
import {
  findUnpaidDebtsByAmount,
  hasProcessedGmailMessage,
  markGmailMessageProcessed,
  clearGmailConnection,
  type ExpenseDebt,
  type UserRecord,
} from "../database/database.js";
import { decryptSecret } from "../lib/credentialCrypto.js";
import { refreshAccessToken } from "../api/routes/gmail.js";
import { classifyPaymentEmail } from "../ai/gmailPaymentReader.js";

const CANDIDATE_QUERY = "newer_than:2d (UPI OR payment OR paid OR received)";
const MAX_CANDIDATE_MESSAGES = 20;
const MIN_CONFIDENCE = 0.6;

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

async function listCandidateMessages(accessToken: string): Promise<GmailMessageListItem[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", CANDIDATE_QUERY);
  url.searchParams.set("maxResults", String(MAX_CANDIDATE_MESSAGES));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail messages.list failed (${res.status})`);
  const body = await res.json();
  return body.messages ?? [];
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Depth-first search for the first text/plain part, falling back to text/html (crudely
 * stripped of tags) — a payment email's useful text is almost always in one of these two. */
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

async function fetchMessage(accessToken: string, messageId: string): Promise<{ subject: string; bodyText: string }> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Gmail messages.get failed (${res.status})`);
  const message: GmailMessage = await res.json();
  const subject = message.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
  const bodyText =
    (message.payload?.body?.data ? decodeBase64Url(message.payload.body.data) : "") ||
    extractBodyText(message.payload as GmailMessagePart | undefined);
  return { subject, bodyText: bodyText.slice(0, 4000) }; // bounded — classification doesn't need a whole email chain
}

/** Never fires more than once per user at a time, even if a slow Gmail API call outlasts the poll
 * cadence — same guard shape as backend/reminders/scheduler.ts's debtsCurrentlyProcessing. */
const usersCurrentlyScanning = new Set<number>();

const MIN_PHONE_DIGIT_MATCH = 4; // a masked "XXXXXX6780" still reveals this many real trailing digits

/**
 * UPI/bank notifications almost always mask a phone number by hiding the middle and showing only
 * the last few digits (e.g. "XXXXXX6780"). Deliberately reads only the identifier's *trailing*
 * contiguous digit run, not every digit anywhere in the string — stripping non-digits globally would
 * wrongly concatenate a separately-visible prefix (e.g. "98XXXXXX10" naively becomes "9810", which
 * isn't really a substring of the actual number at all). A short trailing run below the threshold is
 * left unmatched rather than risked, since it's too generic to reliably identify one person.
 */
function phoneNumbersLikelyMatch(savedPhone: string, identifier: string): boolean {
  const savedDigits = savedPhone.replace(/\D/g, "");
  const trailingRun = identifier.match(/(\d{4,})\D*$/)?.[1] ?? "";
  if (savedDigits.length < MIN_PHONE_DIGIT_MATCH || trailingRun.length < MIN_PHONE_DIGIT_MATCH) return false;
  return savedDigits.endsWith(trailingRun);
}

/**
 * Whoever paid is identified by whatever the email actually gave us — a name, a UPI ID, or a phone
 * number (often partially masked). This is the main lever for telling apart several people who owe
 * the exact same amount (e.g. an even group-expense split), so it checks every saved field that
 * could plausibly appear in a payment notification, not just the display name.
 */
function payerIdentifierLikelyMatchesPerson(
  person: { name: string; telegram_username: string; phone_number: string | null },
  payerIdentifier: string
): boolean {
  const identifier = payerIdentifier.trim().toLowerCase();
  if (!identifier) return false;
  const name = person.name.trim().toLowerCase();
  const username = person.telegram_username.trim().toLowerCase();
  // Deliberately loose (substring either direction) — a UPI app might show "Raj K." for a contact
  // saved as "Raj Kumar", or just their @handle. This only needs to break a tie among debts that
  // already matched on amount, not stand alone as the whole match.
  if (name && (identifier.includes(name) || name.includes(identifier))) return true;
  if (username && identifier.includes(username)) return true;
  if (person.phone_number && phoneNumbersLikelyMatch(person.phone_number, payerIdentifier)) return true;
  return false;
}

/**
 * Amount alone picks the debt when there's exactly one candidate. When several unpaid debts share
 * the same amount — the common case for an evenly split group expense, where everyone owes the
 * identical amount — the email's stated payer identifier (name, UPI ID, or phone number, whatever
 * the model could read) is used to break the tie against each candidate's saved name, Telegram
 * username, and phone number. Only acts when it points at exactly one of the candidates; anything
 * still ambiguous is left alone rather than guessing between two similarly-plausible people.
 */
async function resolveMatch(
  userId: number,
  matches: ExpenseDebt[],
  payerIdentifier: string | null
): Promise<ExpenseDebt | undefined> {
  if (matches.length === 1) return matches[0];
  if (matches.length < 2 || !payerIdentifier) return undefined;

  const candidates = await Promise.all(
    matches.map(async (debt) => ({ debt, person: await profileAgent.findPersonById(userId, debt.person_id) }))
  );
  const identifierMatches = candidates.filter(
    ({ person }) => person && payerIdentifierLikelyMatchesPerson(person, payerIdentifier)
  );
  return identifierMatches.length === 1 ? identifierMatches[0].debt : undefined;
}

export async function scanUserGmailForPayments(user: UserRecord): Promise<void> {
  if (usersCurrentlyScanning.has(user.id)) return;
  usersCurrentlyScanning.add(user.id);
  try {
    if (!user.gmail_refresh_token) return;

    let accessToken: string;
    try {
      const refreshToken = decryptSecret(user.gmail_refresh_token);
      const tokens = await refreshAccessToken(refreshToken);
      accessToken = tokens.access_token;
    } catch (error) {
      if ((error as { invalidGrant?: boolean } | null)?.invalidGrant) {
        // The only case the user asked to surface as "needs reconnecting" — clearing it here makes
        // /api/gmail/status naturally report "Not connected" without any new UI or column.
        console.log(`[gmail-scan] User ${user.id}'s Gmail connection was revoked/expired — disconnecting.`);
        await clearGmailConnection(user.id);
      } else {
        console.error(`[gmail-scan] Couldn't refresh access token for user ${user.id}:`, error);
      }
      return;
    }

    const candidates = await listCandidateMessages(accessToken);
    for (const { id: messageId } of candidates) {
      if (await hasProcessedGmailMessage(user.id, messageId)) continue;

      try {
        const { subject, bodyText } = await fetchMessage(accessToken, messageId);
        const classification = await classifyPaymentEmail(subject, bodyText);

        if (
          !classification.extractionFailed &&
          classification.isPayment &&
          classification.amount != null &&
          classification.confidence >= MIN_CONFIDENCE
        ) {
          const matches = await findUnpaidDebtsByAmount(user.id, classification.amount);
          const matchedDebt = await resolveMatch(user.id, matches, classification.payerIdentifier);
          if (matchedDebt) {
            await agent.markDebtPaid(user.id, matchedDebt.id);
            console.log(
              `[gmail-scan] Matched payment email to debt ${matchedDebt.id} (₹${classification.amount}) for user ${user.id} — marked paid.`
            );
          } else if (matches.length > 1) {
            console.log(
              `[gmail-scan] Payment email for ₹${classification.amount} (user ${user.id}) matched ${matches.length} debts and the payer name didn't disambiguate — ambiguous, leaving for manual reconciliation.`
            );
          }
        }
      } catch (error) {
        console.error(`[gmail-scan] Failed to classify message ${messageId} for user ${user.id}:`, error);
      } finally {
        // Recorded regardless of match outcome (or failure) so this same email is never
        // reclassified on the next tick.
        await markGmailMessageProcessed(user.id, messageId);
      }
    }
  } catch (error) {
    console.error(`[gmail-scan] Failed to scan Gmail for user ${user.id}:`, error);
  } finally {
    usersCurrentlyScanning.delete(user.id);
  }
}
