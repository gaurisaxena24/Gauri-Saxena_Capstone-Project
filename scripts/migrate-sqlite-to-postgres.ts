/**
 * One-time data migration: copies every row out of the old local SQLite file
 * (data/debts.db) into whichever Postgres database DATABASE_URL points at.
 *
 * Safety rules, enforced in code, not just by convention:
 *  - Never touches the source SQLite file — opened read-only in spirit (we
 *    only ever SELECT from it).
 *  - Per table, if the Postgres destination already has ANY rows, that
 *    table is skipped entirely rather than risking a duplicate or a
 *    silent overwrite. Re-running this script is therefore always safe —
 *    it only ever fills empty tables.
 *  - IDs are preserved exactly as they were in SQLite (so existing foreign
 *    keys between people/expenses/expense_debts/reminders stay correct),
 *    and each table's SERIAL sequence is advanced afterward so the next
 *    naturally-created row doesn't collide with a migrated id.
 *
 * Usage:
 *   DATABASE_URL=postgres://...  npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * Run it once against your dev Postgres to verify, and again (with a
 * different DATABASE_URL) against production if you want the same
 * pre-existing people/expenses carried over there too.
 */

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { findProjectRoot } from "../backend/paths.js";
import { ensureDatabaseReady } from "../backend/database/database.js";

const SQLITE_PATH = resolve(findProjectRoot(import.meta.url), "data", "debts.db");

interface TableSpec {
  table: string;
  columns: string[];
}

// Order matters: people/expenses/users/telegram_contacts/debts have no dependencies; expense_debts
// depends on people+expenses; reminders depends on expense_debts+people.
const TABLES: TableSpec[] = [
  { table: "debts", columns: ["id", "name", "amount", "reason", "overdue_period", "relationship", "prior_reminder", "context", "tone", "created_at"] },
  { table: "people", columns: ["id", "name", "telegram_username", "relationship", "notes", "phone_number", "telegram_user_id", "telegram_chat_id", "telegram_verified", "verification_code", "created_at"] },
  { table: "telegram_contacts", columns: ["telegram_username", "chat_id", "last_seen_at"] },
  { table: "users", columns: ["id", "telegram_username", "created_at", "last_login_at"] },
  { table: "expenses", columns: ["id", "source", "merchant", "expense_date", "total", "currency", "tax", "tip", "category", "payment_method", "transaction_reference", "description", "line_items_json", "visible_names_json", "image_path", "raw_extraction_json", "subtotal", "service_charge", "discount", "extraction_confidence", "created_at"] },
  { table: "expense_debts", columns: ["id", "expense_id", "person_id", "amount", "currency", "status", "message", "tone", "message_edited", "context_json", "share_mode", "additional_context", "desired_action", "selected_items_json", "created_at", "paid_at"] },
  { table: "reminders", columns: ["id", "debt_id", "person_id", "message", "tone", "status", "created_at", "sent_at", "telegram_message_id"] },
];

const NUMERIC_ID_TABLES = new Set(["debts", "people", "users", "expenses", "expense_debts", "reminders"]);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL to the Postgres connection string you want to migrate INTO, then re-run.");
    process.exit(1);
  }
  if (!existsSync(SQLITE_PATH)) {
    console.error(`No SQLite file found at ${SQLITE_PATH} — nothing to migrate.`);
    process.exit(1);
  }

  console.log(`Source (read-only): ${SQLITE_PATH}`);
  console.log(`Destination: ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":****@")}`);

  await ensureDatabaseReady();

  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
  });

  try {
    for (const spec of TABLES) {
      const destCount = (await pool.query(`SELECT COUNT(*) AS n FROM ${spec.table}`)).rows[0].n as string;
      if (Number(destCount) > 0) {
        console.log(`SKIP  ${spec.table}: destination already has ${destCount} row(s) — not touching it.`);
        continue;
      }

      const sourceRows = sqlite.prepare(`SELECT ${spec.columns.join(", ")} FROM ${spec.table}`).all() as Array<
        Record<string, unknown>
      >;
      if (sourceRows.length === 0) {
        console.log(`SKIP  ${spec.table}: source has no rows.`);
        continue;
      }

      const placeholders = spec.columns.map((_, i) => `$${i + 1}`).join(", ");
      const insertSql = `INSERT INTO ${spec.table} (${spec.columns.join(", ")}) VALUES (${placeholders})`;

      for (const row of sourceRows) {
        const values = spec.columns.map((col) => {
          const v = row[col];
          // SQLite stores booleans as 0/1 integers already, which Postgres's INTEGER/BOOLEAN
          // columns here both accept as-is (schema keeps these as INTEGER, not BOOLEAN, to match).
          return v;
        });
        await pool.query(insertSql, values);
      }

      if (NUMERIC_ID_TABLES.has(spec.table)) {
        await pool.query(
          `SELECT setval(pg_get_serial_sequence('${spec.table}', 'id'), COALESCE((SELECT MAX(id) FROM ${spec.table}), 1), true)`
        );
      }

      console.log(`DONE  ${spec.table}: migrated ${sourceRows.length} row(s).`);
    }
  } finally {
    sqlite.close();
    await pool.end();
  }

  console.log("\nMigration pass complete.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
