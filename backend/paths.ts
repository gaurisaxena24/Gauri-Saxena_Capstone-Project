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
