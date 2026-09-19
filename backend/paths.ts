import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walks up from the calling module's location to find the project root
 * (marked by package.json). Works whether the module is running from its
 * TypeScript source (tsx, `npm run dev`) or from compiled output nested
 * under compiled/debt-collector-telegram-system/ (`npm start`) — unlike a
 * fixed number of `../` segments, which only holds for one of those two.
 */
export function findProjectRoot(fromFileUrl: string): string {
  let dir = dirname(fileURLToPath(fromFileUrl));
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate project root (package.json) above ${fromFileUrl}`);
}

// Uploaded expense images are still plain files on disk — Postgres now holds the structured data
// (people/expenses/debts/reminders), but binary image uploads don't belong in a SQL column. On
// Railway, the project root is rebuilt from scratch on every deploy/restart (a fresh container
// filesystem), so anything stored there is wiped unless a Railway Volume is attached — Railway
// sets RAILWAY_VOLUME_MOUNT_PATH at runtime when one is, and that's where uploads must live
// instead. Local dev has no such volume, so this env var is unset and the path resolves exactly
// as before.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : resolve(findProjectRoot(import.meta.url), "data");
export const UPLOADS_DIR = resolve(DATA_DIR, "uploads");
