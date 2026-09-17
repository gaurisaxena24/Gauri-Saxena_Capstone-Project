/**
 * SQLite persistence for confirmed debts only.
 *
 * Uses Node's built-in node:sqlite (available without adding a dependency)
 * rather than a third-party driver. This module never sees drafts, preview
 * formatting, or Telegram data — it only ever inserts one final, validated
 * row per approved debt.
 */

import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// data/ lives at the project root, alongside mcp-server/ (not inside it).
const DATA_DIR = resolve(__dirname, "../../../data");
const DB_PATH = resolve(DATA_DIR, "debts.db");

let db: DatabaseSync | undefined;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
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
  return db;
}

export interface SaveDebtInput {
  name: string;
  amount: number;
  reason: string;
  overdue_period: string;
  relationship: string;
  prior_reminder: boolean;
  context?: string;
  tone?: string;
}

export interface SavedDebtRecord extends SaveDebtInput {
  id: number;
  created_at: string;
}

/** Inserts exactly one row. Callers are responsible for not calling this twice for the same draft. */
export function saveDebt(input: SaveDebtInput): SavedDebtRecord {
  const database = getDb();
  const created_at = new Date().toISOString();

  const stmt = database.prepare(
    `INSERT INTO debts (name, amount, reason, overdue_period, relationship, prior_reminder, context, tone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.name,
    input.amount,
    input.reason,
    input.overdue_period,
    input.relationship,
    input.prior_reminder ? 1 : 0,
    input.context ?? null,
    input.tone ?? null,
    created_at
  );

  return {
    id: Number(result.lastInsertRowid),
    created_at,
    ...input,
  };
}
