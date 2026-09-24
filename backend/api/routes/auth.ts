import { Router } from "express";
import {
  createSession,
  createUser,
  deleteSession,
  formatRecoveryCode,
  getUserById,
  recoverAccount,
  type UserRecord,
} from "../../database/database.js";
import { readCookie, requireAuth, SESSION_COOKIE_NAME, type AuthedRequest } from "../middleware/requireAuth.js";

export const authRouter = Router();

const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches createSession's expiry

function setSessionCookie(res: import("express").Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // RAILWAY_ENVIRONMENT is confirmed set on the deployed instance (see
    // shouldRunReminderScheduler() in backend/index.ts) — checked alongside NODE_ENV since nothing
    // in this project's Railway config actually guarantees NODE_ENV=production gets set.
    secure: Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}

function toAuthedJson(user: UserRecord) {
  return { id: user.id, name: user.name, recoveryCode: formatRecoveryCode(user.telegram_username) };
}

/**
 * Onboarding stays exactly as frictionless as it always was — no password, just a name, and you're
 * in. It no longer asks for a Telegram username: that was never how the Telegram bot connects (the
 * bot links to each contact/`people` row directly once they message it, not to the app-owner's
 * account), so collecting it here only added friction. What this issues is a real, server-verified
 * session (an httpOnly cookie checked against the `sessions` table on every request) rather than the
 * frontend just trusting whatever it last saw in localStorage. The account also gets a recovery code
 * (see createUser()) — the one thing the person can use to get back into this same account from
 * elsewhere, now that there's no username to retype.
 */
authRouter.post("/login", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "Tell us what to call you to continue." });
    return;
  }

  const user = await createUser(name);
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json(toAuthedJson(user));
});

/** The "Already have an account?" path — trades a saved recovery code for a fresh session, for
 * whoever already has an account but is on a browser/device without its session cookie. */
authRouter.post("/login/recover", async (req, res) => {
  const code = String(req.body?.code ?? "").trim();
  if (!code) {
    res.status(400).json({ error: "Enter your recovery code to continue." });
    return;
  }

  const user = await recoverAccount(code);
  if (!user) {
    res.status(404).json({ error: "That recovery code doesn't match any account." });
    return;
  }
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json(toAuthedJson(user));
});

authRouter.post("/logout", async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  if (token) await deleteSession(token);
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ loggedOut: true });
});

/** Lets the frontend verify its cached identity against the server instead of blindly trusting
 * localStorage — see frontend/src/context/AuthContext.tsx. */
authRouter.get("/me", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const user = await getUserById(userId);
  if (!user) {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
    return;
  }
  res.json(toAuthedJson(user));
});
