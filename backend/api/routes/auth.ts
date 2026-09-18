import { Router } from "express";
import { upsertUser } from "../../database/database.js";

export const authRouter = Router();

/**
 * Local-development-only "login": maps a Telegram username to a local user
 * record. This is NOT authentication — anyone who types a username in gets
 * in. It exists purely to identify which local user is using the app on
 * this machine, per the project's single-user local MVP scope.
 */
authRouter.post("/login", (req, res) => {
  const telegramUsername = String(req.body?.telegramUsername ?? "").trim();
  if (!telegramUsername) {
    res.status(400).json({ error: "Enter your Telegram username to continue." });
    return;
  }

  const user = upsertUser(telegramUsername);
  res.json({ id: user.id, telegramUsername: user.telegram_username });
});
