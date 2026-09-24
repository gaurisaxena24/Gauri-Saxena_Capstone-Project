/**
 * No-AI reader for OCR'd receipt / payment-screenshot text (skills/expenseReaderSkill.ts). Used
 * whenever the AI can't be reached — Groq rate-limited or paused, no Claude backup — so an uploaded
 * photo still becomes an expense instead of "Couldn't read that image". Plain pattern matching:
 * it finds the total, merchant, date, line items, tax/service/discount, payment method and UPI
 * reference the way a person skimming the bill would. Less clever than the AI (the user reviews
 * every field on the next screen anyway), but it never depends on anything outside this process.
 */

import { randomUUID } from "node:crypto";
import { emptyExpenseExtraction, type ExpenseExtraction, type ExpenseLineItem } from "./types.js";

/** A money-looking number: "1,250.00", "1250", "₹850", "Rs. 99.5" (OCR often turns ₹ into "%" or "Z"). */
const NUMBER = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const AMOUNT_ON_LINE = new RegExp(`(?:₹|rs\\.?|inr|\\$|%|z)?\\s*${NUMBER}(?![\\d/:-])`, "gi");
const CURRENCY_MARKED = new RegExp(`(?:₹|rs\\.?|inr)\\s*${NUMBER}`, "gi");

const SUBTOTAL = /\bsub\s*-?\s*total\b/i;
const GRAND_TOTAL = /\b(grand\s*total|net\s*(amount|payable|total)|amount\s*(payable|due|paid)|total\s*(amount|payable|due)|bill\s*amount|to\s*pay)\b/i;
const TOTAL = /\btotal\b/i;
const TAX = /\b(c\s*gst|s\s*gst|i\s*gst|gst|vat|tax)\b/i;
const SERVICE = /\bservice\s*(charge|chg|fee)\b/i;
const TIP = /\b(tip|gratuity)\b/i;
const DISCOUNT = /\b(discount|disc\.?|off|savings|promo)\b/i;

/** Lines that are never a purchased item. */
const NOT_AN_ITEM =
  /\b(total|sub\s*total|tax|gst|vat|cgst|sgst|service|tip|discount|cash|change|card|upi|paid|balance|round\s*off|date|time|table|bill\s*no|invoice|order\s*no|phone|ph\.?|mob|gstin|fssai|thank|visit|cashier|waiter|guest|pax|qty|rate|amount|price|item|particulars|txn|ref|utr)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT_ON_LINE)) {
    const n = toNumber(m[1]);
    if (n != null) out.push(n);
  }
  return out;
}

function lastAmount(line: string): number | null {
  const all = amountsIn(line);
  return all.length ? all[all.length - 1] : null;
}

function monthNumber(word: string): number | undefined {
  const w = word.toLowerCase();
  return MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Day-first, as on Indian bills: 24/09/2026, 24-09-26, 24.09.2026, 2026-09-24, 24 Sep 2026, Sep 24, 2026. */
function findDate(text: string): string | null {
  let m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,-]+(\d{2,4})\b/i);
  if (m && monthNumber(m[2])) return iso(+m[3], monthNumber(m[2])!, +m[1]);
  m = text.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m && monthNumber(m[1])) return iso(+m[3], monthNumber(m[1])!, +m[2]);
  return null;
}

function findMerchant(lines: string[]): string | null {
  // Payment screenshots name the other party: "Paid to Raj Kumar", "To: Toit Brewpub".
  for (const line of lines) {
    const m = line.match(/\b(?:paid\s+to|payment\s+to|sent\s+to|to)\s*:?\s+([A-Za-z][A-Za-z .&'-]{2,40})/i);
    if (m && !/\byour\b|\bbank\b|\baccount\b/i.test(m[1])) return m[1].trim();
  }
  // Bills put the business name first — skip boilerplate headers and lines that are mostly numbers.
  for (const line of lines.slice(0, 6)) {
    const letters = line.replace(/[^A-Za-z]/g, "").length;
    if (letters < 3 || letters < line.length * 0.5) continue;
    if (/\b(tax\s*invoice|invoice|receipt|bill|cash\s*memo|welcome|gstin|fssai|order|kot)\b/i.test(line)) continue;
    return line.replace(/[^A-Za-z0-9 .&'-]/g, "").trim() || null;
  }
  return null;
}

function findLineItems(lines: string[]): ExpenseLineItem[] {
  const items: ExpenseLineItem[] = [];
  for (const line of lines) {
    if (items.length >= 40) break;
    if (SUBTOTAL.test(line) || GRAND_TOTAL.test(line) || TOTAL.test(line)) break; // items end where totals start
    if (NOT_AN_ITEM.test(line)) continue;
    const firstDigit = line.search(/\d/);
    if (firstDigit < 2) continue; // needs a name before the numbers
    const name = line.slice(0, firstDigit).replace(/[^A-Za-z0-9 &'().-]/g, "").trim();
    if (name.replace(/[^A-Za-z]/g, "").length < 2) continue;
    const numbers = amountsIn(line.slice(firstDigit));
    if (numbers.length === 0) continue;
    const price = numbers[numbers.length - 1];
    const quantity = numbers.length >= 3 && Number.isInteger(numbers[0]) && numbers[0] <= 50 ? numbers[0] : null;
    const unitPrice = numbers.length >= 3 ? numbers[numbers.length - 2] : numbers.length === 2 ? numbers[0] : null;
    const consistent = quantity == null || unitPrice == null || Math.abs(quantity * unitPrice - price) < 0.51;
    items.push({ id: randomUUID(), name, quantity, unitPrice, price, uncertain: !consistent });
  }
  return items;
}

function firstMatchAmount(lines: string[], pattern: RegExp, exclude?: RegExp): number | null {
  for (const line of lines) {
    if (pattern.test(line) && !(exclude && exclude.test(line))) {
      const n = lastAmount(line);
      if (n != null) return n;
    }
  }
  return null;
}

function sumMatchAmounts(lines: string[], pattern: RegExp, exclude?: RegExp): number | null {
  let sum = 0;
  let found = false;
  for (const line of lines) {
    if (pattern.test(line) && !(exclude && exclude.test(line))) {
      const n = lastAmount(line);
      if (n != null) {
        sum += n;
        found = true;
      }
    }
  }
  return found ? Math.round(sum * 100) / 100 : null;
}

export function parseReceiptText(rawText: string): ExpenseExtraction {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const text = lines.join("\n");
  const result = emptyExpenseExtraction();
  if (lines.length === 0) return result;

  result.merchant = findMerchant(lines);
  result.date = findDate(text);
  result.lineItems = findLineItems(lines);
  result.subtotal = firstMatchAmount(lines, SUBTOTAL);
  result.tax = sumMatchAmounts(lines, TAX, /\b(incl|inclusive|gstin|total)\b/i);
  result.serviceCharge = firstMatchAmount(lines, SERVICE);
  result.tip = firstMatchAmount(lines, TIP);
  result.discount = firstMatchAmount(lines, DISCOUNT);

  // Total: an explicit grand-total-style line wins, then a plain "Total" line (the last one on the
  // bill, which is usually the final figure), then the biggest ₹-marked amount (UPI screenshots
  // show the paid amount large with ₹), then the items' sum.
  let total = firstMatchAmount(lines, GRAND_TOTAL, SUBTOTAL);
  if (total == null) {
    const totalLines = lines.filter((l) => TOTAL.test(l) && !SUBTOTAL.test(l));
    for (const l of totalLines.reverse()) {
      total = lastAmount(l);
      if (total != null) break;
    }
  }
  if (total == null) {
    const marked = [...text.matchAll(CURRENCY_MARKED)].map((m) => toNumber(m[1])).filter((n): n is number => n != null);
    if (marked.length) total = Math.max(...marked);
  }
  if (total == null && result.lineItems.length) {
    total = Math.round(result.lineItems.reduce((s, i) => s + i.price, 0) * 100) / 100;
  }
  result.total = total;

  result.currency = /₹|\brs\.?\b|\binr\b|rupee/i.test(text) ? "INR" : /\$|\busd\b/i.test(text) ? "USD" : total != null ? "INR" : null;

  const method = text.match(/\b(google\s*pay|gpay|phonepe|paytm|bhim|upi|credit\s*card|debit\s*card|card|cash|net\s*banking|bank\s*transfer)\b/i);
  if (method) {
    const m = method[1].toLowerCase().replace(/\s+/g, " ");
    result.paymentMethod =
      m === "gpay" || m === "google pay" ? "Google Pay" : m.includes("card") ? "Card" : m === "cash" ? "Cash" : m.includes("bank") ? "Bank Transfer" : "UPI";
  }
  const ref = text.match(/\b(?:utr|upi\s*ref(?:erence)?(?:\s*no)?|transaction\s*id|txn\s*id|ref(?:erence)?\s*(?:no|id))\.?\s*[:#-]?\s*([A-Z0-9]{6,})/i);
  if (ref) result.transactionReference = ref[1];

  if (/\b(restaurant|cafe|café|kitchen|dine|dining|bar|brew|pub|biryani|pizza|burger|food|swiggy|zomato|bistro|dhaba|bakery|chai|coffee)\b/i.test(text)) {
    result.category = "Food & Drinks";
  } else if (/\b(uber|ola|rapido|cab|taxi|metro|fuel|petrol)\b/i.test(text)) {
    result.category = "Transport";
  } else if (/\b(grocery|mart|supermarket|bigbasket|blinkit|zepto|instamart|dmart)\b/i.test(text)) {
    result.category = "Groceries";
  }

  // Honest, low confidence: this is pattern matching over noisy OCR text, and the user checks every
  // field on the review screen.
  result.confidence = total == null ? 0.1 : result.lineItems.length || result.merchant ? 0.45 : 0.3;
  return result;
}
