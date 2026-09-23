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

import { randomUUID } from "node:crypto";
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

/** Adds a nullable `user_id` column to `table` (if not already present), backfills any NULL rows
 * to whichever user already exists (today's one real user, in the common case), and only then
 * tightens the column to NOT NULL — but only once every row genuinely has a non-null owner. On a
 * database where `users` is still completely empty (nobody has ever logged in through the web app
 * yet), the backfill is a no-op and this deliberately leaves the column nullable rather than
 * crashing on SET NOT NULL; claimOrphanedLegacyDataIfFirstUser() finishes the job once a real user
 * exists. Safe to rerun every boot. */
async function addUserIdColumnAndBackfill(db: Pool, table: string): Promise<void> {
  await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`);
  await db.query(
    `UPDATE ${table} SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL`
  );
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE user_id IS NULL`
  );
  if (Number(rows[0]?.count ?? 0) === 0) {
    await db.query(`ALTER TABLE ${table} ALTER COLUMN user_id SET NOT NULL`);
  }
}

/** One-time bootstrap, called from upsertUser() right after a genuinely brand-new `users` row is
 * inserted: if this is truly the very first user this app has ever had log in (current total row
 * count in `users` is exactly 1 — not just "this particular insert was new", so a second or third
 * distinct signup later never misattributes another user's data), claim every still-orphaned
 * people/expenses/expense_debts/reminders row (created before any user_id column existed, or
 * before anyone had logged in — see addUserIdColumnAndBackfill()) as this user's, then retry
 * tightening each column to NOT NULL now that every row has an owner. Fully idempotent: a no-op on
 * every later login once nothing is left NULL. The ALTER attempts are wrapped defensively — a
 * housekeeping constraint tightening must never make a login fail. */
async function claimOrphanedLegacyDataIfFirstUser(db: Pool, newUserId: number): Promise<void> {
  const { rows } = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM users`);
  if (Number(rows[0]?.count ?? 0) !== 1) return;

  const tables = ["people", "expenses", "expense_debts", "reminders"];
  for (const table of tables) {
    await db.query(`UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`, [newUserId]);
  }
  for (const table of tables) {
    try {
      await db.query(`ALTER TABLE ${table} ALTER COLUMN user_id SET NOT NULL`);
    } catch {
      // Non-fatal — every query already scopes by user_id regardless of whether the DB-level
      // constraint itself is in place yet.
    }
  }
}

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
          telegram_username TEXT UNIQUE,
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

    // Real per-request sessions — replaces trusting whatever the frontend's localStorage claims.
    // Multiple concurrent rows per user are expected (multiple browsers/devices), not a bug.
    await db.query(`
      CREATE TABLE IF NOT EXISTS sessions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          token TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
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

    // telegram_username started out required (NOT NULL UNIQUE, see the CREATE TABLE above, which is
    // itself kept unchanged for an already-existing DB) — a contact can now be saved with no
    // Telegram handle at all (verification then only happens via the one-time code, never by
    // username match), so the NOT NULL constraint is dropped here. Safe to rerun: Postgres does not
    // error when dropping a NOT NULL that's already gone. The UNIQUE constraint itself is untouched
    // and needs no change — Postgres treats multiple NULLs in a UNIQUE column (or in the later
    // per-user composite UNIQUE below) as distinct from one another, so any number of people can
    // share a NULL telegram_username without a conflict.
    await db.query(`ALTER TABLE people ALTER COLUMN telegram_username DROP NOT NULL`);

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

    // Gmail connection (OAuth), one per app-user. Only the refresh token is persisted, and always
    // encrypted (see backend/lib/credentialCrypto.ts); the short-lived access token is re-derived
    // from it on demand and never stored. "Connected" is derived from gmail_refresh_token IS NOT
    // NULL rather than a separate boolean column.
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_email TEXT`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_connected_at TEXT`);

    // Retired: an optional pasted-API-key setting used to live here, replaced by Google OAuth
    // (the gmail_* columns above) as the only way this app connects to a Google account. Column
    // kept, unused, rather than dropped — same precedent as the legacy `debts` table above.
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_api_key TEXT`);

    // Tracks which Gmail messages the background payment scanner has already looked at (matched
    // or not), so the same email is never reclassified every tick — Gmail's own search syntax only
    // supports day-granularity dates, so a plain "since last scan" timestamp isn't reliable enough.
    await db.query(`
      CREATE TABLE IF NOT EXISTS gmail_processed_messages (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          message_id TEXT NOT NULL,
          processed_at TEXT NOT NULL,
          UNIQUE (user_id, message_id)
      );
    `);

    // Per-debt Gmail Sync (the user-initiated "Sync" button — see backend/api/routes/debts.ts's
    // POST /:id/sync, backend/gmail/debtSync.ts). Distinct from gmail_processed_messages above,
    // which belongs to the *background* scanner: this stores only the single latest result of a
    // targeted, single-debt check, so the UI can show "Last checked: <time>" without re-syncing.
    // Deliberately no full email body — just enough to show the user which email it was and why,
    // and to detect a stale-but-still-shown-result on the next real sync.
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS gmail_sync_status TEXT`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS gmail_sync_checked_at TEXT`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS gmail_sync_confidence DOUBLE PRECISION`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS gmail_sync_email_id TEXT`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS gmail_sync_email_date TEXT`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS gmail_sync_sender TEXT`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS gmail_sync_subject TEXT`);
    await db.query(`ALTER TABLE expense_debts ADD COLUMN IF NOT EXISTS gmail_sync_reason TEXT`);

    // --- Per-user data isolation --------------------------------------------------------------
    // This app was single-user until now (see the removed getPrimaryUser doc comment) — every
    // person/expense/debt/reminder row was global. Each of the four tables below gets its own
    // owning-user column (denormalized onto expense_debts/reminders too, matching how reminders
    // already stores both debt_id and the redundant person_id rather than requiring a join), added
    // nullable, backfilled to today's one real user, then tightened to NOT NULL — safe to rerun
    // every boot since the UPDATE is a no-op once nothing is NULL.
    //
    // The backfill target is "whichever user already exists" (ORDER BY id ASC LIMIT 1) — but on a
    // database where pre-existing people/expenses/etc. rows were created before anyone had ever
    // logged in through the web app at all (so `users` itself is still empty), that subquery
    // returns NULL and the backfill is a no-op, which used to make the SET NOT NULL below fail and
    // crash the whole boot (seen once in production). addUserIdColumnAndBackfill() now only
    // tightens the constraint once every row genuinely has an owner; if `users` is empty it leaves
    // the column nullable for this boot. The very first real login then finishes the job — see
    // claimOrphanedLegacyDataIfFirstUser() below, called from upsertUser() — which backfills these
    // same rows to that first user and retries the NOT NULL tightening. No data is dropped or
    // hidden permanently either way, just deferred until there's a real owner to assign it to.
    await addUserIdColumnAndBackfill(db, "people");
    await addUserIdColumnAndBackfill(db, "expenses");
    await addUserIdColumnAndBackfill(db, "expense_debts");
    await addUserIdColumnAndBackfill(db, "reminders");

    // people.telegram_username was globally UNIQUE — that actively blocks multi-tenancy (two
    // different app-users each adding a contact with the same handle would collide), so it's
    // swapped for a per-user composite constraint. The old constraint's name is looked up from
    // Postgres's own catalog (whatever single-column UNIQUE constraint actually exists on this
    // column) rather than assumed to be Postgres's default auto-generated name — safe to rerun
    // every boot: a no-op once the old constraint is already gone.
    await db.query(`
      DO $$
      DECLARE
        old_constraint_name text;
      BEGIN
        SELECT con.conname INTO old_constraint_name
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'people'
          AND con.contype = 'u'
          AND con.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'telegram_username')
          ];
        IF old_constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE people DROP CONSTRAINT %I', old_constraint_name);
        END IF;
      END $$;
    `);
    // NOTE: adding a UNIQUE constraint that already exists raises Postgres error 42P07
    // (duplicate_table — it's the backing index that collides), not 42710 (duplicate_object) as a
    // naive `EXCEPTION WHEN duplicate_object` guard would assume; that mismatch let this exact
    // statement crash every boot after the first (caught once in production — see BUILD_LOG.md).
    // An explicit `pg_constraint` existence check sidesteps the exception-class question entirely.
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_user_telegram_username_key') THEN
          ALTER TABLE people ADD CONSTRAINT people_user_telegram_username_key UNIQUE (user_id, telegram_username);
        END IF;
      END $$;
    `);

    // verification_code had no uniqueness constraint at all — harmless odds (~1 in a billion) in a
    // single-user app, but a real cross-tenant collision risk now that multiple app-users' contacts
    // share one global code space (Telegram's incoming message can't know which tenant sent it in
    // advance, so the lookup is deliberately global — see getPersonByVerificationCode — which is
    // exactly why the code itself must be guaranteed unique). Same existence-check style as above,
    // for the same reason (42P07, not 42710, on a re-add).
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_verification_code_key') THEN
          ALTER TABLE people ADD CONSTRAINT people_verification_code_key UNIQUE (verification_code);
        END IF;
      END $$;
    `);
  })();
  return schemaReady;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — easy to type back
const MAX_CODE_GENERATION_ATTEMPTS = 5;

function generateVerificationCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

/** Gives any pre-existing person (created before verification codes existed) a code too. Retries a
 * fresh code on the rare collision against the table's UNIQUE constraint (see ensureSchema) rather
 * than crashing the whole backfill over one unlucky row. */
async function backfillVerificationCodes(db: Pool): Promise<void> {
  const { rows: missing } = await db.query<{ id: number }>(
    `SELECT id FROM people WHERE verification_code IS NULL`
  );
  for (const { id } of missing) {
    for (let attempt = 1; attempt <= MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      try {
        await db.query(`UPDATE people SET verification_code = $1 WHERE id = $2`, [generateVerificationCode(), id]);
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === MAX_CODE_GENERATION_ATTEMPTS) throw error;
      }
    }
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
  user_id: number;
  name: string;
  telegram_username: string | null;
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

export async function createPerson(
  userId: number,
  input: {
    name: string;
    telegramUsername?: string;
    relationship?: string;
    notes?: string;
    phoneNumber?: string;
    keepFormal?: boolean;
  }
): Promise<Person> {
  const database = await getDb();
  const created_at = new Date().toISOString();
  // Telegram username is now optional — a contact with none stored is inserted as NULL (never
  // coerced to an empty string, which would collide with every other usernameless contact under the
  // UNIQUE constraint; NULL is what lets Postgres treat each of them as distinct). They can still be
  // verified later via the one-time code path, which never depends on a stored username.
  const username = input.telegramUsername?.trim() ? normalizeUsername(input.telegramUsername) : null;
  for (let attempt = 1; attempt <= MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
    try {
      const { rows } = await database.query<{ id: number }>(
        `INSERT INTO people (user_id, name, telegram_username, relationship, notes, phone_number, telegram_verified, verification_code, created_at, keep_formal)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9) RETURNING id`,
        [
          userId,
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
      return (await getPerson(userId, rows[0].id))!;
    } catch (error) {
      // A collision on (user_id, telegram_username) is a real "you already added this contact"
      // conflict the caller must see — only retry the rare verification_code collision.
      const isTelegramUsernameConflict =
        isUniqueViolation(error) && (error as { constraint?: string }).constraint?.includes("telegram_username");
      if (!isUniqueViolation(error) || isTelegramUsernameConflict || attempt === MAX_CODE_GENERATION_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw new Error("Couldn't generate a unique verification code.");
}

export async function updatePerson(
  userId: number,
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
  const current = await getPerson(userId, id);
  if (!current) return undefined;
  const next = {
    name: patch.name ?? current.name,
    relationship: patch.relationship !== undefined ? patch.relationship : current.relationship,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    phone_number: patch.phoneNumber !== undefined ? patch.phoneNumber : current.phone_number,
    keep_formal: patch.keepFormal !== undefined ? (patch.keepFormal ? 1 : 0) : current.keep_formal,
  };
  await database.query(
    `UPDATE people SET name = $1, relationship = $2, notes = $3, phone_number = $4, keep_formal = $5
     WHERE id = $6 AND user_id = $7`,
    [next.name, next.relationship, next.notes, next.phone_number, next.keep_formal, id, userId]
  );
  return getPerson(userId, id);
}

/**
 * Deletes one person and only that person. The real foreign keys on
 * `expense_debts.person_id`/`reminders.person_id` mean Postgres itself refuses this delete while
 * any debt still references the person — the API checks for that first and returns a friendly
 * message rather than letting the constraint failure surface. Returns true if deleted, false if
 * the person didn't exist (or doesn't belong to this user).
 */
export async function deletePerson(userId: number, id: number): Promise<boolean> {
  const database = await getDb();
  const existing = await getPerson(userId, id);
  if (!existing) return false;
  await database.query(`DELETE FROM people WHERE id = $1 AND user_id = $2`, [id, userId]);
  return true;
}

export async function getPersonByUsername(userId: number, telegramUsername: string): Promise<Person | undefined> {
  const database = await getDb();
  const username = normalizeUsername(telegramUsername);
  const { rows } = await database.query<Person>(
    `SELECT * FROM people WHERE telegram_username = $1 AND user_id = $2`,
    [username, userId]
  );
  return rows[0];
}

export async function getPerson(userId: number, id: number): Promise<Person | undefined> {
  const database = await getDb();
  const { rows } = await database.query<Person>(`SELECT * FROM people WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0];
}

/** Finds an existing person (belonging to this user) by Telegram username, or creates one. Used
 * when tagging an expense. */
export async function getOrCreatePerson(
  userId: number,
  input: {
    name: string;
    telegramUsername: string;
    relationship?: string;
  }
): Promise<Person> {
  const existing = await getPersonByUsername(userId, input.telegramUsername);
  if (existing) return existing;
  return createPerson(userId, input);
}

export async function listPeopleWithStats(userId: number): Promise<PersonWithStats[]> {
  const database = await getDb();
  const { rows } = await database.query<PersonWithStats>(
    `SELECT
       p.*,
       COALESCE(SUM(CASE WHEN d.status = 'UNPAID' THEN d.amount ELSE 0 END), 0) AS total_owed,
       COALESCE(SUM(CASE WHEN d.status = 'UNPAID' THEN 1 ELSE 0 END), 0) AS open_debts
     FROM people p
     LEFT JOIN expense_debts d ON d.person_id = p.id
     WHERE p.user_id = $1
     GROUP BY p.id
     ORDER BY p.name COLLATE "C" ASC`,
    [userId]
  );
  return rows;
}

/**
 * Marks a person's Telegram identity as verified because the poller just saw a real incoming
 * message from this exact username — the only honest proof available via the Bot API (it can't
 * look up an arbitrary username itself). Deliberately global (not scoped by user_id): if two
 * different app-users each have this same real person as a contact, an incoming message from them
 * should verify *both* app-users' entries, since it's genuinely the same Telegram account reaching
 * out — matching the same reasoning as the code-based verification path below.
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

/** Global by-id lookup, deliberately not scoped by user — for the two Telegram-triggered paths
 * above that only learn which tenant owns a person *after* finding them (by code or by username),
 * not before. Every other caller in this codebase goes through the user-scoped `getPerson`. */
async function getPersonByIdUnscoped(id: number): Promise<Person | undefined> {
  const database = await getDb();
  const { rows } = await database.query<Person>(`SELECT * FROM people WHERE id = $1`, [id]);
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
  return getPersonByIdUnscoped(person.id);
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
  user_id: number;
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

export async function createExpense(
  userId: number,
  input: {
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
  }
): Promise<Expense> {
  const database = await getDb();
  const created_at = new Date().toISOString();
  const { rows } = await database.query<{ id: number }>(
    `INSERT INTO expenses
       (user_id, source, merchant, expense_date, total, currency, subtotal, tax, tip, service_charge, discount,
        category, payment_method, transaction_reference, description, line_items_json,
        visible_names_json, image_path, raw_extraction_json, extraction_confidence, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     RETURNING id`,
    [
      userId,
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
  return (await getExpense(userId, rows[0].id))!;
}

export async function getExpense(userId: number, id: number): Promise<Expense | undefined> {
  const database = await getDb();
  const { rows } = await database.query<Expense>(`SELECT * FROM expenses WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return rows[0];
}

export async function listExpenses(userId: number, limit = 100): Promise<Expense[]> {
  const database = await getDb();
  const { rows } = await database.query<Expense>(
    `SELECT * FROM expenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/**
 * Deletes one expense and only that expense — never `people`, never `expense_debts`. The real
 * foreign key on `expense_debts.expense_id` means Postgres itself refuses this delete while any
 * debt still references the expense (the API checks for that first and returns a friendly error
 * rather than letting the constraint failure surface). Returns the deleted row's `image_path` (so
 * the caller can clean up the uploaded file) or undefined if the expense didn't exist.
 */
export async function deleteExpense(
  userId: number,
  id: number
): Promise<{ imagePath: string | null } | undefined> {
  const database = await getDb();
  const existing = await getExpense(userId, id);
  if (!existing) return undefined;
  await database.query(`DELETE FROM expenses WHERE id = $1 AND user_id = $2`, [id, userId]);
  return { imagePath: existing.image_path };
}

/** Lets the user correct extracted (or manually-entered) fields before attaching a person/debt. */
export async function updateExpense(
  userId: number,
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
  const current = await getExpense(userId, id);
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
       service_charge = $8, discount = $9, category = $10, payment_method = $11, description = $12, line_items_json = $13
     WHERE id = $14 AND user_id = $15`,
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
      userId,
    ]
  );

  return getExpense(userId, id);
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
  user_id: number;
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
  /** Latest (and only ever "latest") result of a user-initiated Gmail Sync check — see
   * updateDebtGmailSync below. Null until the "Sync" button has been used at least once. */
  gmail_sync_status: DebtGmailSyncStatus | null;
  gmail_sync_checked_at: string | null;
  gmail_sync_confidence: number | null;
  gmail_sync_email_id: string | null;
  gmail_sync_email_date: string | null;
  gmail_sync_sender: string | null;
  gmail_sync_subject: string | null;
  gmail_sync_reason: string | null;
}

export type DebtGmailSyncStatus = "PAYMENT_FOUND" | "POSSIBLE_PAYMENT" | "NO_PAYMENT_FOUND";

export async function createExpenseDebt(
  userId: number,
  input: {
    expenseId: number;
    personId: number;
    amount: number;
    currency: string | null;
    shareMode: ShareModeValue;
    additionalContext: string | null;
    desiredAction: string | null;
    contextJson: unknown;
    selectedItems?: Array<{ name: string; amount: number }> | null;
  }
): Promise<ExpenseDebt> {
  const database = await getDb();
  const created_at = new Date().toISOString();
  const { rows } = await database.query<{ id: number }>(
    `INSERT INTO expense_debts
       (user_id, expense_id, person_id, amount, currency, status, context_json, share_mode, additional_context, desired_action, selected_items_json, created_at)
     VALUES ($1, $2, $3, $4, $5, 'UNPAID', $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      userId,
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
  return (await getExpenseDebt(userId, rows[0].id))!;
}

export async function getExpenseDebt(userId: number, id: number): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(
    `SELECT * FROM expense_debts WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rows[0];
}

export async function getDebtsForExpense(userId: number, expenseId: number): Promise<ExpenseDebt[]> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(
    `SELECT * FROM expense_debts WHERE expense_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
    [expenseId, userId]
  );
  return rows;
}

export async function getDebtsForPerson(userId: number, personId: number): Promise<ExpenseDebt[]> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(
    `SELECT * FROM expense_debts WHERE person_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
    [personId, userId]
  );
  return rows;
}

export async function listRecentDebts(userId: number, limit = 100): Promise<ExpenseDebt[]> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(
    `SELECT * FROM expense_debts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function updateDebtContext(
  userId: number,
  id: number,
  context: unknown
): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  await database.query(`UPDATE expense_debts SET context_json = $1 WHERE id = $2 AND user_id = $3`, [
    JSON.stringify(context),
    id,
    userId,
  ]);
  return getExpenseDebt(userId, id);
}

export async function updateDebtDraftMessage(
  userId: number,
  id: number,
  patch: { message: string; tone: string | null; edited: boolean }
): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  await database.query(
    `UPDATE expense_debts SET message = $1, tone = $2, message_edited = $3 WHERE id = $4 AND user_id = $5`,
    [patch.message, patch.tone, patch.edited ? 1 : 0, id, userId]
  );
  return getExpenseDebt(userId, id);
}

export async function setDebtStatus(
  userId: number,
  id: number,
  status: DebtStatus
): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  await database.query(`UPDATE expense_debts SET status = $1, paid_at = $2 WHERE id = $3 AND user_id = $4`, [
    status,
    status === "PAID" ? new Date().toISOString() : null,
    id,
    userId,
  ]);
  return getExpenseDebt(userId, id);
}

/**
 * Persists the single latest result of a user-initiated Gmail Sync check (see
 * backend/gmail/debtSync.ts) — overwrites whatever was stored before, since only the most recent
 * check is ever shown ("Last checked: <time>" + "Sync again"). Only called for a real, completed
 * check (PAYMENT_FOUND / POSSIBLE_PAYMENT / NO_PAYMENT_FOUND); GMAIL_NOT_CONNECTED /
 * GMAIL_PERMISSION_REQUIRED / SYNC_ERROR never reach here, so a transient failure never clobbers a
 * previously-stored real result. Never stores a full email body — just enough to show the user
 * which email it was and why (see the ALTER TABLE comments in ensureSchema).
 */
export async function updateDebtGmailSync(
  userId: number,
  id: number,
  patch: {
    status: DebtGmailSyncStatus;
    confidence: number | null;
    emailId: string | null;
    emailDate: string | null;
    sender: string | null;
    subject: string | null;
    reason: string | null;
  }
): Promise<ExpenseDebt | undefined> {
  const database = await getDb();
  await database.query(
    `UPDATE expense_debts
       SET gmail_sync_status = $1, gmail_sync_checked_at = $2, gmail_sync_confidence = $3,
           gmail_sync_email_id = $4, gmail_sync_email_date = $5, gmail_sync_sender = $6,
           gmail_sync_subject = $7, gmail_sync_reason = $8
     WHERE id = $9 AND user_id = $10`,
    [
      patch.status,
      new Date().toISOString(),
      patch.confidence,
      patch.emailId,
      patch.emailDate,
      patch.sender,
      patch.subject,
      patch.reason,
      id,
      userId,
    ]
  );
  return getExpenseDebt(userId, id);
}

/**
 * Deletes one debt ("send request") and only that debt — its own send-history rows in
 * `reminders`, and the `expense_debts` row itself. Never touches `people` or `expenses`; the
 * person and the underlying expense this debt was drafted against are always left exactly as
 * they were. Returns false if the debt didn't exist (or doesn't belong to this user), true otherwise.
 */
export async function deleteExpenseDebt(userId: number, id: number): Promise<boolean> {
  const database = await getDb();
  const existing = await getExpenseDebt(userId, id);
  if (!existing) return false;
  await database.query(`DELETE FROM reminders WHERE debt_id = $1 AND user_id = $2`, [id, userId]);
  await database.query(`DELETE FROM expense_debts WHERE id = $1 AND user_id = $2`, [id, userId]);
  return true;
}

export interface DashboardStats {
  totalOwed: number;
  peopleOwing: number;
  remindersSent: number;
}

export async function getDashboardStats(userId: number): Promise<DashboardStats> {
  const database = await getDb();
  const totalOwed = (
    await database.query<{ v: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM expense_debts WHERE status = 'UNPAID' AND user_id = $1`,
      [userId]
    )
  ).rows[0].v;
  const peopleOwing = (
    await database.query<{ v: number }>(
      `SELECT COUNT(DISTINCT person_id) AS v FROM expense_debts WHERE status = 'UNPAID' AND user_id = $1`,
      [userId]
    )
  ).rows[0].v;
  const remindersSent = (
    await database.query<{ v: number }>(`SELECT COUNT(*) AS v FROM reminders WHERE status = 'SENT' AND user_id = $1`, [
      userId,
    ])
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
  user_id: number;
  debt_id: number;
  person_id: number;
  message: string;
  tone: string | null;
  status: ReminderStatus;
  created_at: string;
  sent_at: string | null;
  telegram_message_id: string | null;
}

export async function recordReminder(
  userId: number,
  input: {
    debtId: number;
    personId: number;
    message: string;
    tone: string | null;
    status: ReminderStatus;
    telegramMessageId?: string | number | null;
  }
): Promise<Reminder> {
  const database = await getDb();
  const created_at = new Date().toISOString();
  const { rows } = await database.query<Reminder>(
    `INSERT INTO reminders (user_id, debt_id, person_id, message, tone, status, created_at, sent_at, telegram_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      userId,
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

export async function listReminders(userId: number, limit = 100): Promise<Reminder[]> {
  const database = await getDb();
  const { rows } = await database.query<Reminder>(
    `SELECT * FROM reminders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function getRemindersForDebt(userId: number, debtId: number): Promise<Reminder[]> {
  const database = await getDb();
  const { rows } = await database.query<Reminder>(
    `SELECT * FROM reminders WHERE debt_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
    [debtId, userId]
  );
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

export async function getRemindersForPerson(userId: number, personId: number): Promise<Reminder[]> {
  const database = await getDb();
  const { rows } = await database.query<Reminder>(
    `SELECT * FROM reminders WHERE person_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
    [personId, userId]
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
  gmail_email: string | null;
  gmail_refresh_token: string | null;
  gmail_connected_at: string | null;
  google_api_key: string | null;
}

/** Logging in with a Telegram username that doesn't exist yet creates an account — this app has no
 * password/signup flow, by design (see backend/api/routes/auth.ts); every app-user is a real,
 * separate tenant from here on, not "the" one user. */
export async function upsertUser(telegramUsername: string): Promise<UserRecord> {
  const database = await getDb();
  const username = normalizeUsername(telegramUsername);
  const now = new Date().toISOString();
  const { rows: upserted } = await database.query<{ id: number; inserted: boolean }>(
    `INSERT INTO users (telegram_username, created_at, last_login_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_username) DO UPDATE SET last_login_at = EXCLUDED.last_login_at
     RETURNING id, (xmax = 0) AS inserted`,
    [username, now, now]
  );
  const { id, inserted } = upserted[0];
  if (inserted) {
    // Brand-new user row — see claimOrphanedLegacyDataIfFirstUser() for why this only actually
    // does anything when it's genuinely the very first user this app has ever had.
    await claimOrphanedLegacyDataIfFirstUser(database, id);
  }
  const { rows } = await database.query<UserRecord>(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0];
}

export async function getUserById(id: number): Promise<UserRecord | undefined> {
  const database = await getDb();
  const { rows } = await database.query<UserRecord>(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0];
}

/** Names the app-user who actually owns this specific `person` row, for the bot's "you're now
 * connected to @X's expense tracker" reply — replaces the old getPrimaryUser() (which just grabbed
 * the first-ever registered user, back when there was only ever one). */
export async function getOwnerOfPerson(personId: number): Promise<UserRecord | undefined> {
  const database = await getDb();
  const { rows } = await database.query<UserRecord>(
    `SELECT u.* FROM users u JOIN people p ON p.user_id = u.id WHERE p.id = $1`,
    [personId]
  );
  return rows[0];
}

/** Stores (or overwrites) a user's Gmail connection. `encryptedRefreshToken` must already be
 * encrypted (see backend/lib/credentialCrypto.ts) — this function never sees a plaintext token. */
export async function saveGmailConnection(
  userId: number,
  input: { email: string; encryptedRefreshToken: string }
): Promise<void> {
  const database = await getDb();
  await database.query(
    `UPDATE users SET gmail_email = $1, gmail_refresh_token = $2, gmail_connected_at = $3 WHERE id = $4`,
    [input.email, input.encryptedRefreshToken, new Date().toISOString(), userId]
  );
}

export async function clearGmailConnection(userId: number): Promise<void> {
  const database = await getDb();
  await database.query(
    `UPDATE users SET gmail_email = NULL, gmail_refresh_token = NULL, gmail_connected_at = NULL WHERE id = $1`,
    [userId]
  );
}

/** Every app-user with a live Gmail connection — polled by the background payment scanner. */
export async function listUsersWithGmailConnected(): Promise<UserRecord[]> {
  const database = await getDb();
  const { rows } = await database.query<UserRecord>(`SELECT * FROM users WHERE gmail_refresh_token IS NOT NULL`);
  return rows;
}

// ---------------------------------------------------------------------------
// Gmail background payment detection (backend/gmail/paymentScanner.ts)
// ---------------------------------------------------------------------------

export async function hasProcessedGmailMessage(userId: number, messageId: string): Promise<boolean> {
  const database = await getDb();
  const { rows } = await database.query(
    `SELECT 1 FROM gmail_processed_messages WHERE user_id = $1 AND message_id = $2`,
    [userId, messageId]
  );
  return rows.length > 0;
}

export async function markGmailMessageProcessed(userId: number, messageId: string): Promise<void> {
  const database = await getDb();
  await database.query(
    `INSERT INTO gmail_processed_messages (user_id, message_id, processed_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, message_id) DO NOTHING`,
    [userId, messageId, new Date().toISOString()]
  );
}

/** Candidate debts for the payment scanner to match a detected amount against — deliberately an
 * exact-amount match only, scoped to this user's own unpaid debts. Returns every match rather than
 * picking one: the caller only auto-acts when there's exactly one (a wrong auto-mark-paid is worse
 * than a missed one), leaving zero-or-multiple-match cases for the user to reconcile manually. */
// Within half a paisa — `amount` is DOUBLE PRECISION, so a debt amount computed from a split
// (rather than typed in directly) can carry harmless floating-point rounding drift; a real
// payment email's stated amount should never differ from the actual debt by more than this.
const AMOUNT_MATCH_TOLERANCE = 0.005;

export async function findUnpaidDebtsByAmount(userId: number, amount: number): Promise<ExpenseDebt[]> {
  const database = await getDb();
  const { rows } = await database.query<ExpenseDebt>(
    `SELECT * FROM expense_debts WHERE user_id = $1 AND status = 'UNPAID' AND ABS(amount - $2) < $3`,
    [userId, amount, AMOUNT_MATCH_TOLERANCE]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Sessions (real per-request identity — see backend/api/middleware/requireAuth.ts)
// ---------------------------------------------------------------------------

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(userId: number): Promise<string> {
  const database = await getDb();
  const token = randomUUID();
  const now = new Date();
  await database.query(
    `INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, token, now.toISOString(), new Date(now.getTime() + SESSION_DURATION_MS).toISOString()]
  );
  return token;
}

export async function getSessionUser(token: string): Promise<UserRecord | undefined> {
  const database = await getDb();
  const { rows } = await database.query<UserRecord>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > $2`,
    [token, new Date().toISOString()]
  );
  return rows[0];
}

export async function deleteSession(token: string): Promise<void> {
  const database = await getDb();
  await database.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}
