import { Router } from "express";
import { createSession, deleteSession, getUserById, upsertUser } from "../../database/database.js";
import { readCookie, requireAuth, SESSION_COOKIE_NAME, type AuthedRequest } from "../middleware/requireAuth.js";

export const authRouter = Router();

const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches createSession's expiry

/**
 * Login stays exactly as frictionless as it always was — type a Telegram username, no password,
 * get in (creating an account on first use). What changed is that this now issues a real,
 * server-verified session (an httpOnly cookie checked against the `sessions` table on every
 * request) instead of the frontend just trusting whatever it last saw in localStorage.
 */
authRouter.post("/login", async (req, res) => {
  const telegramUsername = String(req.body?.telegramUsername ?? "").trim();
  if (!telegramUsername) {
    res.status(400).json({ error: "Enter your Telegram username to continue." });
    return;
  }

  const user = await upsertUser(telegramUsername);
  const token = await createSession(user.id);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // RAILWAY_ENVIRONMENT is confirmed set on the deployed instance (see
    // shouldRunReminderScheduler() in backend/index.ts) — checked alongside NODE_ENV since nothing
    // in this project's Railway config actually guarantees NODE_ENV=production gets set.
    secure: Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
  res.json({ id: user.id, telegramUsername: user.telegram_username });
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
  res.json({ id: user.id, telegramUsername: user.telegram_username });
});
