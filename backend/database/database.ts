/**
 * SQLite persistence.
 *
 * Uses Node's built-in node:sqlite (available without adding a dependency)
 * rather than a third-party driver.
 *
 * Two generations of schema live in the same file:
 *  - `debts` is the retired conversational Telegram flow's table. No code
 *    writes to it anymore, but its historical rows are kept — never dropped.
 *  - `people` / `expenses` / `expense_debts` / `reminders` power the web app's
 *    expense-tracking flow (manual entry or image upload → person → debt →
 *    AI reminder → Telegram), which is now the only way expenses/debts are
 *    created. `people` is extended additively (phone number, Telegram
 *    verification) rather than replaced.
 */

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { findProjectRoot } from "../paths.js";

// data/ lives at the project root, found by walking up to package.json —
// works whether this runs from source (tsx) or compiled output.
const DATA_DIR = resolve(findProjectRoot(import.meta.url), "data");
const DB_PATH = resolve(DATA_DIR, "debts.db");
export const UPLOADS_DIR = resolve(DATA_DIR, "uploads");

let db: DatabaseSync | undefined;

/** Adds a nullable column to an existing table if it isn't already there. Safe to call every startup. */
function addColumnIfMissing(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string
): void {
  const existing = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (existing.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — easy to type back

function generateVerificationCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

/** Gives any pre-existing person (created before verification codes existed) a code too. */
function backfillVerificationCodes(database: DatabaseSync): void {
  const missing = database
    .prepare(`SELECT id FROM people WHERE verification_code IS NULL`)
    .all() as Array<{ id: number }>;
  for (const { id } of missing) {
    database.prepare(`UPDATE people SET verification_code = ? WHERE id = ?`).run(generateVerificationCode(), id);
  }
}

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);

  // Original Telegram-only flow's table — schema and rows untouched.
  db.exec(`
    CREATE TABLE IF NOT EXISTS debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        reason TEXT NOT NULL,
        overdue_period TEXT NOT NULL,
        relationship TEXT NOT NULL,
        prior_reminder BOOLEAN NOT NULL,
        context TEXT,
        tone TEXT,
        created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        telegram_username TEXT NOT NULL UNIQUE,
        relationship TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_contacts (
        telegram_username TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_username TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        merchant TEXT,
        expense_date TEXT,
        total REAL NOT NULL,
        currency TEXT,
        tax REAL,
        tip REAL,
        category TEXT,
        payment_method TEXT,
        transaction_reference TEXT,
        description TEXT,
        line_items_json TEXT,
        visible_names_json TEXT,
        image_path TEXT,
        raw_extraction_json TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense_debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_id INTEGER NOT NULL REFERENCES expenses(id),
        person_id INTEGER NOT NULL REFERENCES people(id),
        amount REAL NOT NULL,
        currency TEXT,
        status TEXT NOT NULL DEFAULT 'UNPAID',
        message TEXT,
        tone TEXT,
        message_edited INTEGER NOT NULL DEFAULT 0,
        context_json TEXT,
        created_at TEXT NOT NULL,
        paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debt_id INTEGER NOT NULL REFERENCES expense_debts(id),
        person_id INTEGER NOT NULL REFERENCES people(id),
        message TEXT NOT NULL,
        tone TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        telegram_message_id TEXT
    );
  `);

  // people: extended additively for phone + real Telegram verification.
  addColumnIfMissing(db, "people", "notes", "TEXT");
  addColumnIfMissing(db, "people", "phone_number", "TEXT");
  addColumnIfMissing(db, "people", "telegram_user_id", "TEXT");
  addColumnIfMissing(db, "people", "telegram_chat_id", "TEXT");
  addColumnIfMissing(db, "people", "telegram_verified", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "people", "verification_code", "TEXT");
  backfillVerificationCodes(db);

  // How much of the expense this debt covers, plus optional context the user
  // supplies when creating it — both feed the AI reminder's social context.
  addColumnIfMissing(db, "expense_debts", "share_mode", "TEXT");
  addColumnIfMissing(db, "expense_debts", "additional_context", "TEXT");
  addColumnIfMissing(db, "expense_debts", "desired_action", "TEXT");

  // Superseded by expenses/expense_debts (previous iteration of the web
  // flow, before "expense" replaced "bill" as the core object). Both were
  // introduced by this same web app and are empty of anything but already-
  // cleaned-up test data, so dropping is safe.
  db.exec(`DROP TABLE IF EXISTS bills`);
  db.exec(`DROP TABLE IF EXISTS ai_keys`);

  return db;
}

/** Strips a leading "@" and lowercases, so "@Rahul123", "rahul123" and "Rahul123" all match one contact. */
function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface Person {
  id: number;
  name: string;
  telegram_username: string;
  relationship: string | null;
  notes: string | null;
  phone_number: string | null;
  telegram_user_id: string | null;
  telegram_chat_id: string | null;
  telegram_verified: number;
  verification_code: string;
  created_at: string;
}

export interface PersonWithStats extends Person {
  total_owed: number;
  open_debts: number;
}

export function createPerson(input: {
  name: string;
  telegramUsername: string;
  relationship?: string;
  notes?: string;
  phoneNumber?: string;
}): Person {
  const database = getDb();
  const created_at = new Date().toISOString();
  const username = normalizeUsername(input.telegramUsername);
  const stmt = database.prepare(
    `INSERT INTO people (name, telegram_username, relationship, notes, phone_number, telegram_verified, verification_code, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  );
  const result = stmt.run(
    input.name,
    username,
    input.relationship ?? null,
    input.notes ?? null,
    input.phoneNumber ?? null,
    generateVerificationCode(),
    created_at
  );
  return getPerson(Number(result.lastInsertRowid))!;
}

export function updatePerson(
  id: number,
  patch: Partial<{ name: string; relationship: string | null; notes: string | null; phoneNumber: string | null }>
): Person | undefined {
  const database = getDb();
  const current = getPerson(id);
  if (!current) return undefined;
  const next = {
    name: patch.name ?? current.name,
    relationship: patch.relationship !== undefined ? patch.relationship : current.relationship,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    phone_number: patch.phoneNumber !== undefined ? patch.phoneNumber : current.phone_number,
  };
  database
    .prepare(`UPDATE people SET name = ?, relationship = ?, notes = ?, phone_number = ? WHERE id = ?`)
    .run(next.name, next.relationship, next.notes, next.phone_number, id);
  return getPerson(id);
}

export function getPersonByUsername(telegramUsername: string): Person | undefined {
  const database = getDb();
  const username = normalizeUsername(telegramUsername);
  return database
    .prepare(`SELECT * FROM people WHERE telegram_username = ?`)
    .get(username) as Person | undefined;
}

export function getPerson(id: number): Person | undefined {
  const database = getDb();
  return database.prepare(`SELECT * FROM people WHERE id = ?`).get(id) as Person | undefined;
}

/** Finds an existing person by Telegram username, or creates one. Used when tagging an expense. */
export function getOrCreatePerson(input: {
  name: string;
  telegramUsername: string;
  relationship?: string;
}): Person {
  const existing = getPersonByUsername(input.telegramUsername);
  if (existing) return existing;
  return createPerson(input);
}

export function listPeopleWithStats(): PersonWithStats[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT
         p.*,
         COALESCE(SUM(CASE WHEN d.status = 'UNPAID' THEN d.amount ELSE 0 END), 0) AS total_owed,
         COALESCE(SUM(CASE WHEN d.status = 'UNPAID' THEN 1 ELSE 0 END), 0) AS open_debts
       FROM people p
       LEFT JOIN expense_debts d ON d.person_id = p.id
       GROUP BY p.id
       ORDER BY p.name COLLATE NOCASE ASC`
    )
    .all() as unknown as PersonWithStats[];
}

/**
 * Marks a person's Telegram identity as verified because the poller just saw
 * a real incoming message from this exact username — the only honest proof
 * available via the Bot API (it can't look up an arbitrary username itself).
 */
export function verifyPersonTelegram(
  telegramUsername: string,
  chatId: string | number,
  telegramUserId: string | number
): void {
  const database = getDb();
  const username = normalizeUsername(telegramUsername);
  database
    .prepare(
      `UPDATE people SET telegram_chat_id = ?, telegram_user_id = ?, telegram_verified = 1
       WHERE telegram_username = ?`
    )
    .run(String(chatId), String(telegramUserId), username);
}

export function getPersonByVerificationCode(code: string): Person | undefined {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM people WHERE verification_code = ?`)
    .get(code.trim().toUpperCase()) as Person | undefined;
}

/**
 * Verifies a person by the one-time code they sent the bot, rather than by
 * username — the only option for a Telegram account with no public
 * @username set, which the Bot API otherwise gives no way to identify.
 */
export function verifyPersonByCode(
  code: string,
  chatId: string | number,
  telegramUserId: string | number
): Person | undefined {
  const database = getDb();
  const person = getPersonByVerificationCode(code);
  if (!person) return undefined;
  database
    .prepare(`UPDATE people SET telegram_chat_id = ?, telegram_user_id = ?, telegram_verified = 1 WHERE id = ?`)
    .run(String(chatId), String(telegramUserId), person.id);
  return getPerson(person.id);
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseSource = "MANUAL" | "IMAGE";

export interface ExpenseLineItem {
  name: string;
  price: number;
}

export interface Expense {
  id: number;
  source: ExpenseSource;
  merchant: string | null;
  expense_date: string | null;
  total: number;
  currency: string | null;
  tax: number | null;
  tip: number | null;
  category: string | null;
  payment_method: string | null;
  transaction_reference: string | null;
  description: string | null;
  line_items_json: string | null;
  visible_names_json: string | null;
  image_path: string | null;
  raw_extraction_json: string | null;
  created_at: string;
}

export function createExpense(input: {
  source: ExpenseSource;
  merchant: string | null;
  expenseDate: string | null;
  total: number;
  currency: string | null;
  tax: number | null;
  tip: number | null;
  category: string | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  description: string | null;
  lineItems: ExpenseLineItem[];
  visibleNames: string[];
  imagePath: string | null;
  rawExtraction: unknown;
}): Expense {
  const database = getDb();
  const created_at = new Date().toISOString();
  const stmt = database.prepare(
    `INSERT INTO expenses
       (source, merchant, expense_date, total, currency, tax, tip, category, payment_method,
        transaction_reference, description, line_items_json, visible_names_json, image_path,
        raw_extraction_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.source,
    input.merchant,
    input.expenseDate,
    input.total,
    input.currency,
    input.tax,
    input.tip,
    input.category,
    input.paymentMethod,
    input.transactionReference,
    input.description,
    JSON.stringify(input.lineItems),
    JSON.stringify(input.visibleNames),
    input.imagePath,
    JSON.stringify(input.rawExtraction ?? null),
    created_at
  );
  return getExpense(Number(result.lastInsertRowid))!;
}

export function getExpense(id: number): Expense | undefined {
  const database = getDb();
  return database.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id) as Expense | undefined;
}

export function listExpenses(limit = 100): Expense[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM expenses ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as Expense[];
}

/** Lets the user correct extracted (or manually-entered) fields before attaching a person/debt. */
export function updateExpense(
  id: number,
  patch: Partial<{
    merchant: string | null;
    expenseDate: string | null;
    total: number;
    currency: string | null;
    tax: number | null;
    tip: number | null;
    category: string | null;
    paymentMethod: string | null;
    description: string | null;
    lineItems: ExpenseLineItem[];
  }>
): Expense | undefined {
  const database = getDb();
  const current = getExpense(id);
  if (!current) return undefined;

  const next = {
    merchant: patch.merchant !== undefined ? patch.merchant : current.merchant,
    expense_date: patch.expenseDate !== undefined ? patch.expenseDate : current.expense_date,
    total: patch.total !== undefined ? patch.total : current.total,
    currency: patch.currency !== undefined ? patch.currency : current.currency,
    tax: patch.tax !== undefined ? patch.tax : current.tax,
    tip: patch.tip !== undefined ? patch.tip : current.tip,
    category: patch.category !== undefined ? patch.category : current.category,
    payment_method: patch.paymentMethod !== undefined ? patch.paymentMethod : current.payment_method,
    description: patch.description !== undefined ? patch.description : current.description,
    line_items_json: patch.lineItems !== undefined ? JSON.stringify(patch.lineItems) : current.line_items_json,
  };

  database
    .prepare(
      `UPDATE expenses SET merchant = ?, expense_date = ?, total = ?, currency = ?, tax = ?, tip = ?,
         category = ?, payment_method = ?, description = ?, line_items_json = ? WHERE id = ?`
    )
    .run(
      next.merchant,
      next.expense_date,
      next.total,
      next.currency,
      next.tax,
      next.tip,
      next.category,
      next.payment_method,
      next.description,
      next.line_items_json,
      id
    );

  return getExpense(id);
}

// ---------------------------------------------------------------------------
// Expense debts — one row per person's share of one expense. Multiple rows
// against the same expense_id is how more than one person can be attached to
// a single expense; nothing here assumes exactly one.
// ---------------------------------------------------------------------------

export type DebtStatus = "UNPAID" | "PAID";

export type ShareModeValue = "FULL" | "HALF" | "CUSTOM";

export interface ExpenseDebt {
  id: number;
  expense_id: number;
  person_id: number;
  amount: number;
  currency: string | null;
  status: DebtStatus;
  message: string | null;
  tone: string | null;
  message_edited: number;
  context_json: string | null;
  share_mode: ShareModeValue | null;
  additional_context: string | null;
  desired_action: string | null;
  created_at: string;
  paid_at: string | null;
}

export function createExpenseDebt(input: {
  expenseId: number;
  personId: number;
  amount: number;
  currency: string | null;
  shareMode: ShareModeValue;
  additionalContext: string | null;
  desiredAction: string | null;
  contextJson: unknown;
}): ExpenseDebt {
  const database = getDb();
  const created_at = new Date().toISOString();
  const stmt = database.prepare(
    `INSERT INTO expense_debts
       (expense_id, person_id, amount, currency, status, context_json, share_mode, additional_context, desired_action, created_at)
     VALUES (?, ?, ?, ?, 'UNPAID', ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.expenseId,
    input.personId,
    input.amount,
    input.currency,
    input.contextJson != null ? JSON.stringify(input.contextJson) : null,
    input.shareMode,
    input.additionalContext,
    input.desiredAction,
    created_at
  );
  return getExpenseDebt(Number(result.lastInsertRowid))!;
}

export function getExpenseDebt(id: number): ExpenseDebt | undefined {
  const database = getDb();
  return database.prepare(`SELECT * FROM expense_debts WHERE id = ?`).get(id) as ExpenseDebt | undefined;
}

export function getDebtsForExpense(expenseId: number): ExpenseDebt[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM expense_debts WHERE expense_id = ? ORDER BY created_at ASC`)
    .all(expenseId) as unknown as ExpenseDebt[];
}

export function getDebtsForPerson(personId: number): ExpenseDebt[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM expense_debts WHERE person_id = ? ORDER BY created_at DESC`)
    .all(personId) as unknown as ExpenseDebt[];
}

export function listRecentDebts(limit = 100): ExpenseDebt[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM expense_debts ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as ExpenseDebt[];
}

export function updateDebtContext(id: number, context: unknown): ExpenseDebt | undefined {
  const database = getDb();
  database.prepare(`UPDATE expense_debts SET context_json = ? WHERE id = ?`).run(JSON.stringify(context), id);
  return getExpenseDebt(id);
}

export function updateDebtDraftMessage(
  id: number,
  patch: { message: string; tone: string | null; edited: boolean }
): ExpenseDebt | undefined {
  const database = getDb();
  database
    .prepare(`UPDATE expense_debts SET message = ?, tone = ?, message_edited = ? WHERE id = ?`)
    .run(patch.message, patch.tone, patch.edited ? 1 : 0, id);
  return getExpenseDebt(id);
}

export function setDebtStatus(id: number, status: DebtStatus): ExpenseDebt | undefined {
  const database = getDb();
  database
    .prepare(`UPDATE expense_debts SET status = ?, paid_at = ? WHERE id = ?`)
    .run(status, status === "PAID" ? new Date().toISOString() : null, id);
  return getExpenseDebt(id);
}

export interface DashboardStats {
  totalOwed: number;
  peopleOwing: number;
  remindersSent: number;
}

export function getDashboardStats(): DashboardStats {
  const database = getDb();
  const totalOwed = (
    database.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM expense_debts WHERE status = 'UNPAID'`).get() as {
      v: number;
    }
  ).v;
  const peopleOwing = (
    database
      .prepare(`SELECT COUNT(DISTINCT person_id) AS v FROM expense_debts WHERE status = 'UNPAID'`)
      .get() as { v: number }
  ).v;
  const remindersSent = (
    database.prepare(`SELECT COUNT(*) AS v FROM reminders WHERE status = 'SENT'`).get() as { v: number }
  ).v;
  return { totalOwed, peopleOwing, remindersSent };
}

// ---------------------------------------------------------------------------
// Reminders — the permanent send-attempt audit log. `expense_debts.message`
// above is the current *draft*; a row here is only ever written once a send
// (successful or failed) actually happens.
// ---------------------------------------------------------------------------

export type ReminderStatus = "SENT" | "FAILED";

export interface Reminder {
  id: number;
  debt_id: number;
  person_id: number;
  message: string;
  tone: string | null;
  status: ReminderStatus;
  created_at: string;
  sent_at: string | null;
  telegram_message_id: string | null;
}

export function recordReminder(input: {
  debtId: number;
  personId: number;
  message: string;
  tone: string | null;
  status: ReminderStatus;
  telegramMessageId?: string | number | null;
}): Reminder {
  const database = getDb();
  const created_at = new Date().toISOString();
  const stmt = database.prepare(
    `INSERT INTO reminders (debt_id, person_id, message, tone, status, created_at, sent_at, telegram_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.debtId,
    input.personId,
    input.message,
    input.tone,
    input.status,
    created_at,
    input.status === "SENT" ? created_at : null,
    input.telegramMessageId != null ? String(input.telegramMessageId) : null
  );
  return database
    .prepare(`SELECT * FROM reminders WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as unknown as Reminder;
}

export function listReminders(limit = 100): Reminder[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM reminders ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as Reminder[];
}

export function getRemindersForDebt(debtId: number): Reminder[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM reminders WHERE debt_id = ? ORDER BY created_at DESC`)
    .all(debtId) as unknown as Reminder[];
}

export function getRemindersForPerson(personId: number): Reminder[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM reminders WHERE person_id = ? ORDER BY created_at DESC`)
    .all(personId) as unknown as Reminder[];
}

// ---------------------------------------------------------------------------
// Telegram contact cache — populated by the poller from real incoming
// messages, since the Bot API can only send to a numeric chat_id, never a
// bare username. Kept alongside `people.telegram_*` (which is the source of
// truth for verification); this is a lower-level cache the poller also uses.
// ---------------------------------------------------------------------------

export function upsertTelegramContact(username: string, chatId: string | number): void {
  const database = getDb();
  const normalized = normalizeUsername(username);
  database
    .prepare(
      `INSERT INTO telegram_contacts (telegram_username, chat_id, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_username) DO UPDATE SET chat_id = excluded.chat_id, last_seen_at = excluded.last_seen_at`
    )
    .run(normalized, String(chatId), new Date().toISOString());
}

export function getChatIdForUsername(username: string): string | undefined {
  const database = getDb();
  const normalized = normalizeUsername(username);
  const row = database
    .prepare(`SELECT chat_id FROM telegram_contacts WHERE telegram_username = ?`)
    .get(normalized) as { chat_id: string } | undefined;
  return row?.chat_id;
}

// ---------------------------------------------------------------------------
// Users (local-dev "login" — see backend/api/routes/auth.ts)
// ---------------------------------------------------------------------------

export interface UserRecord {
  id: number;
  telegram_username: string;
  created_at: string;
  last_login_at: string;
}

export function upsertUser(telegramUsername: string): UserRecord {
  const database = getDb();
  const username = normalizeUsername(telegramUsername);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO users (telegram_username, created_at, last_login_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_username) DO UPDATE SET last_login_at = excluded.last_login_at`
    )
    .run(username, now, now);
  return database
    .prepare(`SELECT * FROM users WHERE telegram_username = ?`)
    .get(username) as unknown as UserRecord;
}
