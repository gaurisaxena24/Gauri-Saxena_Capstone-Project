/**
 * The first per-request identity mechanism this app has ever had — every route this sits in front
 * of previously operated globally, trusting nothing about who was asking. Reads the session cookie
 * set by POST /api/auth/login (see backend/api/routes/auth.ts) and resolves it to a real user via
 * the `sessions` table (backend/database/database.ts). Manual cookie parsing rather than adding
 * `cookie-parser` — there's exactly one cookie to read, matching this codebase's existing
 * preference for built-ins over libraries (e.g. credentialCrypto.ts using Node's own `crypto`).
 */

import type { NextFunction, Request, Response } from "express";
import { getSessionUser } from "../../database/database.js";

export const SESSION_COOKIE_NAME = "udc_session";

export interface AuthedRequest extends Request {
  userId: number;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  if (!token) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  const user = await getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
    return;
  }
  (req as AuthedRequest).userId = user.id;
  next();
}
