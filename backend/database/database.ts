/**
 * PostgreSQL persistence.
 *
 * Was previously `node:sqlite` writing to a local file — that file lived on
 * whatever disk the process happened to be running on, which on Railway
 * meant a fresh, empty filesystem every redeploy/restart unless a Volume was
 * attached (and in production, none was — see BUILD_LOG.md). A managed
 * Postgres database removes that failure mode entirely: the data lives in
 * its own service, independent of the backend container's lifecycle.
 *
 * Two generations of schema live in the same database:
 *  - `debts` is the retired conversational Telegram flow's table. No code
 *    writes to it anymore, but its historical rows (if any existed) are
 *    preserved by the migration script — never dropped.
 *  - `people` / `expenses` / `expense_debts` / `reminders` power the web
 *    app's expense-tracking flow (manual entry or image upload → person →
 *    debt → AI reminder → Telegram), which is now the only way
 *    expenses/debts are created. `people` is extended additively (phone
 *    number, Telegram verification) rather than replaced.
 *
 * Every exported function here now returns a Promise — the synchronous
 * `node:sqlite` API this replaced let every call site read like plain
 * function calls, but `pg` is Promise-based (it talks to a real network
 * service), so every caller up the chain (skills, routes, the Telegram
 * poller) had to become `async`/`await` too. That ripple is intentional and
 * complete, not partial.
 */

import { Pool } from "pg";

let pool: Pool | undefined;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Set it to a Postgres connection string (see .env.example)."
    );
  }
  // Railway's internal Postgres URL isn't behind a proxy that needs SSL, but its public/external
  // one (used from local dev) is — sslmode is negotiated automatically by most Postgres hosts via
  // the connection string itself, but Railway's does not always encode it, so ssl is requested
  // whenever the host isn't localhost and left off otherwise (so a local/dev Postgres without TLS
  // still connects).
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  pool = new Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  return pool;
}

let schemaReady: Promise<void> | undefined;

/** Idempotent, purely additive schema setup — safe to run on every startup, never drops or truncates. */
function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = getPool();

    // Original Telegram-only flow's table — schema and rows untouched.
    await db.query(`
      CREATE TABLE IF NOT EXISTS debts (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          amount DOUBLE PRECISION NOT NULL,
          reason TEXT NOT NULL,
          overdue_period TEXT NOT NULL,
          relationship TEXT NOT NULL,
          prior_reminder BOOLEAN NOT NULL,
          context TEXT,
          tone TEXT,
          created_at TEXT NOT NULL
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS people (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          telegram_username TEXT NOT NULL UNIQUE,
          relationship TEXT,
          created_at TEXT NOT NULL
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS telegram_contacts (
          telegram_username TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          telegram_username TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_login_at TEXT NOT NULL
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS expenses (
          id SERIAL PRIMARY KEY,
          source TEXT NOT NULL,
          merchant TEXT,
          expense_date TEXT,
          total DOUBLE PRECISION NOT NULL,
          currency TEXT,
          tax DOUBLE PRECISION,
          tip DOUBLE PRECISION,
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
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS expense_debts (
          id SERIAL PRIMARY KEY,
          expense_id INTEGER NOT NULL REFERENCES expenses(id),
          person_id INTEGER NOT NULL REFERENCES people(id),
          amount DOUBLE PRECISION NOT NULL,
          currency TEXT,
          status TEXT NOT NULL DEFAULT 'UNPAID',
          message TEXT,
          tone TEXT,
          message_edited INTEGER NOT NULL DEFAULT 0,
          context_json TEXT,
          created_at TEXT NOT NULL,
          paid_at TEXT
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS reminders (
          id SERIAL PRIMARY KEY,
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
    await db.query(`ALTER TABLE people ADD COLUMN IF NOT EXISTS notes TEXT`);
    await db.query(`ALTER TABLE people ADD COLUMN IF NOT EXISTS phone_number TEXT`);
    await db.query(`ALTER TABLE people ADD COLUMN IF NOT EXISTS telegram_user_id TEXT`);
    await db.query(`ALTER TABLE people ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT`);
    await db.query(
      `ALTER TABLE people ADD COLUMN IF NOT EXISTS telegram_verified INTEGER NOT NULL DEFAULT 0`
    );
    await db.query(`ALTER TABLE people ADD COLUMN IF NOT EXISTS verification_code TEXT`);
    await backfillVerificationCodes(db);
    // Manual override: when true, forces restrained/formal treatment (see skills/formalitySkill.ts)
    // regardless of what `relationship` says or how an automatic reminder would otherwise escalate.
    // Defaults to 0 (not set) so existing rows fall back to relationship-keyword auto-detection.
    await db.query(`ALTER TABLE people ADD COLUMN IF NOT EXISTS keep_formal INTEGER NOT NULL DEFAULT 0`);

    // How much of the expense this debt covers, plus optional context the user
    // supplies when creating it — both feed the AI reminder's social context.
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS share_mode TEXT`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS additional_context TEXT`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS desired_action TEXT`);
    // Which specific bill item(s) (if any) this particular debt covers — e.g. [{"name":"Chicken
    // Biryani","amount":450}]. Set only when the debt was built from an itemized bill via the
    // item-selection UI; null for a flat manual amount or a non-itemized screenshot. Feeds the AI
    // reminder ("your share of the biryani") without ever inventing items beyond what's stored here.
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS selected_items_json TEXT`);

    // Itemized-bill facts extracted alongside the existing tax/tip fields — kept distinct from
    // `total` (the grand total) so tax/service/discount can be applied to a partial item selection
    // rather than assumed to already be baked into whatever the person owes.
    await db.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subtotal DOUBLE PRECISION`);
    await db.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS service_charge DOUBLE PRECISION`);
    await db.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS discount DOUBLE PRECISION`);
    await db.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS extraction_confidence DOUBLE PRECISION`);
  })();
  return schemaReady;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — easy to type back

function generateVerificationCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

/** Gives any pre-existing person (created before verification codes existed) a code too. */
async function backfillVerificationCodes(db: Pool): Promise<void> {
  const { rows: missing } = await db.query<{ id: number }>(
    `SELECT id FROM people WHERE verification_code IS NULL`
  );
  for (const { id } of missing) {
    await db.query(`UPDATE people SET verification_code = $1 WHERE id = $2`, [generateVerificationCode(), id]);
  }
}

async function getDb(): Promise<Pool> {
  await ensureSchema();
  return getPool();
}

/**
 * Runs schema setup eagerly at process startup rather than waiting for the first incoming
 * request to trigger it lazily — a bad or missing DATABASE_URL then fails loudly in the startup
 * log instead of surfacing as a mysterious 500 on whatever request happens to arrive first.
 */
export async function ensureDatabaseReady(): Promise<void> {
  await ensureSchema();
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
  keep_formal: number;
}

export interface PersonWithStats extends Person {
  total_owed: number;
  open_debts: number;
}

export async function createPerson(input: {
  name: string;
  telegramUsername: string;
  relationship?: string;
  notes?: string;
  phoneNumber?: string;
  keepFormal?: boolean;
}): Promise<Person> {
  const database = await getDb();
  const created_at = new Date().toISOString();
  const username = normalizeUsername(input.telegramUsername);
  const { rows } = await database.query<{ id: number }>(
    `INSERT INTO people (name, telegram_username, relationship, notes, phone_number, telegram_verified, verification_code, created_at, keep_formal)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8) RETURNING id`,
    [
      input.name,
      username,
      input.relationship ?? null,
      input.notes ?? null,
      input.phoneNumber ?? null,
      generateVerificationCode(),
      created_at,
      input.keepFormal ? 1 : 0,
    ]
  );
  return (await getPerson(rows[0].id))!;
}

export async function updatePerson(
  id: number,
  patch: Partial<{
    name: string;
    relationship: string | null;
    notes: string | null;
    phoneNumber: string | null;
    keepFormal: boolean;
  }>
): Promise<Person | undefined> {
  const database = await getDb();
  const current = await getPerson(id);
  if (!current) return undefined;
  const next = {
    name: patch.name ?? current.name,
    relationship: patch.relationship !== undefined ? patch.relationship : current.relationship,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    phone_number: patch.phoneNumber !== undefined ? patch.phoneNumber : current.phone_number,
    keep_formal: patch.keepFormal !== undefined ? (patch.keepFormal ? 1 : 0) : current.keep_formal,
  };
  await database.query(
    `UPDATE people SET name = $1, relationship = $2, notes = $3, phone_number = $4, keep_formal = $5 WHERE id = $6`,
    [next.name, next.relationship, next.notes, next.phone_number, next.keep_formal, id]
  );
  return getPerson(id);
}

/**
 * Deletes one person and only that person. The real foreign keys on
 * `expense_debts.person_id`/`reminders.person_id` mean Postgres itself refuses this delete while
 * any debt still references the person — the API checks for that first and returns a friendly
 * message rather than letting the constraint failure surface. Returns true if deleted, false if
 * the person didn't exist.
 */
export async function deletePerson(id: number): Promise<boolean> {
  const database = await getDb();
  const existing = await getPerson(id);
  if (!existing) return false;
  await database.query(`DELETE FROM people WHERE id = $1`, [id]);
  return true;
}

export async function getPersonByUsername(telegramUsername: string): Promise<Person | undefined> {
  const database = await getDb();
  const username = normalizeUsername(telegramUsername);
  const { rows } = await database.query<Person>(`SELECT * FROM people WHERE telegram_username = $1`, [username]);
  return rows[0];
}

export async function getPerson(id: number): Promise<Person | undefined> {
  const database = await getDb();
  const { rows } = await database.query<Person>(`SELECT * FROM people WHERE id = $1`, [id]);
  return rows[0];
}

/** Finds an existing person by Telegram username, or creates one. Used when tagging an expense. */
export async function getOrCreatePerson(input: {
  name: string;
  telegramUsername: string;
  relationship?: string;
}): Promise<Person> {
  const existing = await getPersonByUsername(input.telegramUsername);
  if (existing) return existing;
  return createPerson(input);
}

export async function listPeopleWithStats(): Promise<PersonWithStats[]> {
  const database = await getDb();
  const { rows } = await database.query<PersonWithStats>(
    `SELECT
       p.*,
       COALESCE(SUM(CASE WHEN d.status = 'UNPAID' THEN d.amount ELSE 0 END), 0) AS total_owed,
       COALESCE(SUM(CASE WHEN d.status = 'UNPAID' THEN 1 ELSE 0 END), 0) AS open_debts
     FROM people p
     LEFT JOIN expense_debts d ON d.person_id = p.id
     GROUP BY p.id
     ORDER BY p.name COLLATE "C" ASC`
  );
  return rows;
}

/**
 * Marks a person's Telegram identity as verified because the poller just saw
 * a real incoming message from this exact username — the only honest proof
 * available via the Bot API (it can't look up an arbitrary username itself).
 */
export async function verifyPersonTelegram(
  telegramUsername: string,
  chatId: string | number,
  telegramUserId: string | number
): Promise<void> {
  const database = await getDb();
  const username = normalizeUsername(telegramUsername);
  await database.query(
    `UPDATE people SET telegram_chat_id = $1, telegram_user_id = $2, telegram_verified = 1
     WHERE telegram_username = $3`,
    [String(chatId), String(telegramUserId), username]
  );
}

export async function getPersonByVerificationCode(code: string): Promise<Person | undefined> {
  const database = await getDb();
  const { rows } = await database.query<Person>(`SELECT * FROM people WHERE verification_code = $1`, [
    code.trim().toUpperCase(),
  ]);
  return rows[0];
}

/**
 * Verifies a person by the one-time code they sent the bot, rather than by
 * username — the only option for a Telegram account with no public
 * @username set, which the Bot API otherwise gives no way to identify.
 */
export async function verifyPersonByCode(
  code: string,
  chatId: string | number,
  telegramUserId: string | number
): Promise<Person | undefined> {
  const database = await getDb();
  const person = await getPersonByVerificationCode(code);
  if (!person) return undefined;
  await database.query(
    `UPDATE people SET telegram_chat_id = $1, telegram_user_id = $2, telegram_verified = 1 WHERE id = $3`,
    [String(chatId), String(telegramUserId), person.id]
  );
  return getPerson(person.id);
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseSource = "MANUAL" | "IMAGE";

export interface ExpenseLineItem {
  id: string;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  price: number;
  uncertain: boolean;
}

export interface Expense {
  id: number;
  source: ExpenseSource;
  merchant: string | null;
  expense_date: string | null;
  total: number;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  service_charge: number | null;
  discount: number | null;
  category: string | null;
  payment_method: string | null;
  transaction_reference: string | null;
  description: string | null;
  line_items_json: string | null;
  visible_names_json: string | null;
  image_path: string | null;
  raw_extraction_json: string | null;
  extraction_confidence: number | null;
  created_at: string;
}

export async function createExpense(input: {
  source: ExpenseSource;
  merchant: string | null;
  expenseDate: string | null;
  total: number;
  currency: string | null;
  subtotal?: number | null;
  tax: number | null;
  tip: number | null;
  serviceCharge?: number | null;
  discount?: number | null;
  category: string | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  description: string | null;
  lineItems: ExpenseLineItem[];
  visibleNames: string[];
  imagePath: string | null;
  rawExtraction: unknown;
  confidence?: number | null;
}): Promise<Expense> {
  const database = await getDb();
  const created_at = new Date().toISOString();
  const { rows } = await database.query<{ id: number }>(
    `INSERT INTO expenses
       (source, merchant, expense_date, total, currency, subtotal, tax, tip, service_charge, discount,
        category, payment_method, transaction_reference, description, line_items_json,
        visible_names_json, image_path, raw_extraction_json, extraction_confidence, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING id`,
    [
      input.source,
      input.merchant,
      input.expenseDate,
      input.total,
      input.currency,
      input.subtotal ?? null,
      input.tax,
      input.tip,
      input.serviceCharge ?? null,
      input.discount ?? null,
      input.category,
      input.paymentMethod,
      input.transactionReference,
      input.description,
      JSON.stringify(input.lineItems),
      JSON.stringify(input.visibleNames),
      input.imagePath,
      JSON.stringify(input.rawExtraction ?? null),
      input.confidence ?? null,
      created_at,
    ]
  );
  return (await getExpense(rows[0].id))!;
}

export async function getExpense(id: number): Promise<Expense | undefined> {
  const database = await getDb();
  const { rows } = await database.query<Expense>(`SELECT * FROM expenses WHERE id = $1`, [id]);
  return rows[0];
}

export async function listExpenses(limit = 100): Promise<Expense[]> {
  const database = await getDb();
  const { rows } = await database.query<Expense>(`SELECT * FROM expenses ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows;
}

/**
 * Deletes one expense and only that expense — never `people`, never `expense_debts`. The real
 * foreign key on `expense_debts.expense_id` means Postgres itself refuses this delete while any
 * debt still references the expense (the API checks for that first and returns a friendly error
 * rather than letting the constraint failure surface). Returns the deleted row's `image_path` (so
 * the caller can clean up the uploaded file) or undefined if the expense didn't exist.
 */
export async function deleteExpense(id: number): Promise<{ imagePath: string | null } | undefined> {
  const database = await getDb();
  const existing = await getExpense(id);
  if (!existing) return undefined;
  await database.query(`DELETE FROM expenses WHERE id = $1`, [id]);
  return { imagePath: existing.image_path };
}

/** Lets the user correct extracted (or manually-entered) fields before attaching a person/debt. */
export async function updateExpense(
  id: number,
  patch: Partial<{
    merchant: string | null;
    expenseDate: string | null;
    total: number;
    currency: string | null;
    subtotal: number | null;
    tax: number | null;
    tip: number | null;
    serviceCharge: number | null;
    discount: number | null;
    category: string | null;
    paymentMethod: string | null;
    description: string | null;
    lineItems: ExpenseLineItem[];
  }>
): Promise<Expense | undefined> {
  const database = await getDb();
  const current = await getExpense(id);
  if (!current) return undefined;

  const next = {
    merchant: patch.merchant !== undefined ? patch.merchant : current.merchant,
    expense_date: patch.expenseDate !== undefined ? patch.expenseDate : current.expense_date,
    total: patch.total !== undefined ? patch.total : current.total,
    currency: patch.currency !== undefined ? patch.currency : current.currency,
    subtotal: patch.subtotal !== undefined ? patch.subtotal : current.subtotal,
    tax: patch.tax !== undefined ? patch.tax : current.tax,
    tip: patch.tip !== undefined ? patch.tip : current.tip,
    service_charge: patch.serviceCharge !== undefined ? patch.serviceCharge : current.service_charge,
    discount: patch.discount !== undefined ? patch.discount : current.discount,
    category: patch.category !== undefined ? patch.category : current.category,
    payment_method: patch.paymentMethod !== undefined ? patch.paymentMethod : current.payment_method,
    description: patch.description !== undefined ? patch.description : current.description,
    line_items_json: patch.lineItems !== undefined ? JSON.stringify(patch.lineItems) : current.line_items_json,
  };

  await database.query(
    `UPDATE expenses SET merchant = $1, expense_date = $2, total = $3, currency = $4, subtotal = $5, tax = $6, tip = $7,
       service_charge = $8, discount = $9, category = $10, payment_method = $11, description = $12, line_items_json = $13 WHERE id = $14`,
    [
      next.merchant,
      next.expense_date,
      next.total,
      next.currency,
      next.subtotal,
      next.tax,
      next.tip,
      next.service_charge,
      next.discount,
      next.category,
      next.payment_method,
      next.description,
      next.line_items_json,
      id,
    ]
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
  selected_items_json: string | null;
  created_at: string;
  paid_at: string | null;
}

export async function createExpenseDebt(input: {
  expenseId: number;
  personId: number;
  amount: number;
  currency: string | null;
  shareMode: ShareModeValue;
  additionalContext: string | null;
  desiredAction: string | null;
  contextJson: unknown;
  selectedItems?: Array<{ name: string; amount: number }> | null;
}): Promise<ExpenseDebt> {
  const database = await getDb();
  const created_at = new Date().toISOString();
  const { rows } = await database.query<{ id: number }>(
    `INSERT INTO expense_debts
       (expense_id, person_id, amount, currency, status, context_json, share_mode, additional_context, desired_action, selected_items_json, created_at)
     VALUES ($1, $2, $3, $4, 'UNPAID', $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.expenseId,
      input.personId,
      input.amount,
      input.currency,
      input.contextJson != null ? JSON.stringify(input.contextJson) : null,
      input.shareMode,
      input.additionalContext,
      input.desiredAction,
      input.selectedItems && input.selectedItems.length > 0 ? JSON.stringify(input.selectedItems) : null,
      created_at,
    ]
  );
  return (await getExpenseDebt(rows[0].id))!;
}

export async function getExpenseDebt(id: number): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(`SELECT * FROM expense_debts WHERE id = $1`, [id]);
  return rows[0];
}

export async function getDebtsForExpense(expenseId: number): Promise<ExpenseDebt[]> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(
    `SELECT * FROM expense_debts WHERE expense_id = $1 ORDER BY created_at ASC`,
    [expenseId]
  );
  return rows;
}

export async function getDebtsForPerson(personId: number): Promise<ExpenseDebt[]> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(
    `SELECT * FROM expense_debts WHERE person_id = $1 ORDER BY created_at DESC`,
    [personId]
  );
  return rows;
}

export async function listRecentDebts(limit = 100): Promise<ExpenseDebt[]> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(`SELECT * FROM expense_debts ORDER BY created_at DESC LIMIT $1`, [
    limit,
  ]);
  return rows;
}

export async function updateDebtContext(id: number, context: unknown): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  await database.query(`UPDATE expense_debts SET context_json = $1 WHERE id = $2`, [JSON.stringify(context), id]);
  return getExpenseDebt(id);
}

export async function updateDebtDraftMessage(
  id: number,
  patch: { message: string; tone: string | null; edited: boolean }
): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  await database.query(`UPDATE expense_debts SET message = $1, tone = $2, message_edited = $3 WHERE id = $4`, [
    patch.message,
    patch.tone,
    patch.edited ? 1 : 0,
    id,
  ]);
  return getExpenseDebt(id);
}

export async function setDebtStatus(id: number, status: DebtStatus): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  await database.query(`UPDATE expense_debts SET status = $1, paid_at = $2 WHERE id = $3`, [
    status,
    status === "PAID" ? new Date().toISOString() : null,
    id,
  ]);
  return getExpenseDebt(id);
}

/**
 * Deletes one debt ("send request") and only that debt — its own send-history rows in
 * `reminders`, and the `expense_debts` row itself. Never touches `people` or `expenses`; the
 * person and the underlying expense this debt was drafted against are always left exactly as
 * they were. Returns false if the debt didn't exist (nothing to delete), true otherwise.
 */
export async function deleteExpenseDebt(id: number): Promise<boolean> {
  const database = await getDb();
  const existing = await getExpenseDebt(id);
  if (!existing) return false;
  await database.query(`DELETE FROM reminders WHERE debt_id = $1`, [id]);
  await database.query(`DELETE FROM expense_debts WHERE id = $1`, [id]);
  return true;
}

export interface DashboardStats {
  totalOwed: number;
  peopleOwing: number;
  remindersSent: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const database = await getDb();
  const totalOwed = (
    await database.query<{ v: number }>(`SELECT COALESCE(SUM(amount), 0) AS v FROM expense_debts WHERE status = 'UNPAID'`)
  ).rows[0].v;
  const peopleOwing = (
    await database.query<{ v: number }>(
      `SELECT COUNT(DISTINCT person_id) AS v FROM expense_debts WHERE status = 'UNPAID'`
    )
  ).rows[0].v;
  const remindersSent = (
    await database.query<{ v: number }>(`SELECT COUNT(*) AS v FROM reminders WHERE status = 'SENT'`)
  ).rows[0].v;
  return { totalOwed: Number(totalOwed), peopleOwing: Number(peopleOwing), remindersSent: Number(remindersSent) };
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

export async function recordReminder(input: {
  debtId: number;
  personId: number;
  message: string;
  tone: string | null;
  status: ReminderStatus;
  telegramMessageId?: string | number | null;
}): Promise<Reminder> {
  const database = await getDb();
  const created_at = new Date().toISOString();
  const { rows } = await database.query<Reminder>(
    `INSERT INTO reminders (debt_id, person_id, message, tone, status, created_at, sent_at, telegram_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      input.debtId,
      input.personId,
      input.message,
      input.tone,
      input.status,
      created_at,
      input.status === "SENT" ? created_at : null,
      input.telegramMessageId != null ? String(input.telegramMessageId) : null,
    ]
  );
  return rows[0];
}

export async function listReminders(limit = 100): Promise<Reminder[]> {
  const database = await getDb();
  const { rows } = await database.query<Reminder>(`SELECT * FROM reminders ORDER BY created_at DESC LIMIT $1`, [
    limit,
  ]);
  return rows;
}

export async function getRemindersForDebt(debtId: number): Promise<Reminder[]> {
  const database = await getDb();
  const { rows } = await database.query<Reminder>(`SELECT * FROM reminders WHERE debt_id = $1 ORDER BY created_at DESC`, [
    debtId,
  ]);
  return rows;
}

/**
 * Debts eligible for an automatic follow-up reminder right now — used only by the reminder
 * scheduler (backend/reminders/scheduler.ts). A debt qualifies when it's still UNPAID, it has at
 * least one reminder that was actually SENT (i.e. its first reminder was manually approved and
 * really went out — never before that), and the most recent SENT reminder's `sent_at` is at least
 * `REMINDER_INTERVAL_MINUTES` old (expressed here as `cutoffIso`, the caller's
 * now-minus-interval timestamp). Marking a debt PAID removes it from this result on the very next
 * call — there is no separate "cancel automatic reminders" flag or mechanism.
 */
export async function getDebtsDueForAutomaticFollowUp(cutoffIso: string): Promise<ExpenseDebt[]> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(
    `SELECT d.* FROM expense_debts d
     WHERE d.status = 'UNPAID'
       AND EXISTS (SELECT 1 FROM reminders r WHERE r.debt_id = d.id AND r.status = 'SENT')
       AND (
         SELECT MAX(r2.sent_at) FROM reminders r2 WHERE r2.debt_id = d.id AND r2.status = 'SENT'
       ) <= $1
     ORDER BY d.id ASC`,
    [cutoffIso]
  );
  return rows;
}

export async function getRemindersForPerson(personId: number): Promise<Reminder[]> {
  const database = await getDb();
  const { rows } = await database.query<Reminder>(
    `SELECT * FROM reminders WHERE person_id = $1 ORDER BY created_at DESC`,
    [personId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Telegram contact cache — populated by the poller from real incoming
// messages, since the Bot API can only send to a numeric chat_id, never a
// bare username. Kept alongside `people.telegram_*` (which is the source of
// truth for verification); this is a lower-level cache the poller also uses.
// ---------------------------------------------------------------------------

export async function upsertTelegramContact(username: string, chatId: string | number): Promise<void> {
  const database = await getDb();
  const normalized = normalizeUsername(username);
  await database.query(
    `INSERT INTO telegram_contacts (telegram_username, chat_id, last_seen_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_username) DO UPDATE SET chat_id = EXCLUDED.chat_id, last_seen_at = EXCLUDED.last_seen_at`,
    [normalized, String(chatId), new Date().toISOString()]
  );
}

export async function getChatIdForUsername(username: string): Promise<string | undefined> {
  const database = await getDb();
  const normalized = normalizeUsername(username);
  const { rows } = await database.query<{ chat_id: string }>(
    `SELECT chat_id FROM telegram_contacts WHERE telegram_username = $1`,
    [normalized]
  );
  return rows[0]?.chat_id;
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

export async function upsertUser(telegramUsername: string): Promise<UserRecord> {
  const database = await getDb();
  const username = normalizeUsername(telegramUsername);
  const now = new Date().toISOString();
  await database.query(
    `INSERT INTO users (telegram_username, created_at, last_login_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_username) DO UPDATE SET last_login_at = EXCLUDED.last_login_at`,
    [username, now, now]
  );
  const { rows } = await database.query<UserRecord>(`SELECT * FROM users WHERE telegram_username = $1`, [username]);
  return rows[0];
}

/**
 * This is a single-user local-dev app (see routes/auth.ts) — there is exactly one real row in
 * `users` in normal use. Used to name the actual app owner (by their own Telegram username, the
 * only identity this table stores) in the bot's reply to someone who just verified themselves,
 * instead of hardcoding a name. Returns undefined if no one has logged in yet.
 */
export async function getPrimaryUser(): Promise<UserRecord | undefined> {
  const database = await getDb();
  const { rows } = await database.query<UserRecord>(`SELECT * FROM users ORDER BY id ASC LIMIT 1`);
  return rows[0];
}
