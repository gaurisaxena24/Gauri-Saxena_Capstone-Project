import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { UPLOADS_DIR } from "../paths.js";
import { isGroqConfigured } from "../ai/groqClient.js";
import { getBotUsername } from "../telegram/rawApi.js";
import { findProjectRoot } from "../paths.js";
import { authRouter } from "./routes/auth.js";
import { peopleRouter } from "./routes/people.js";
import { expensesRouter } from "./routes/expenses.js";
import { debtsRouter } from "./routes/debts.js";
import { remindersRouter } from "./routes/reminders.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { gmailRouter, isGmailConfigured } from "./routes/gmail.js";
import { settingsRouter } from "./routes/settings.js";
import { getReminderIntervalMinutes } from "../reminders/schedulerConfig.js";
import { requireAuth } from "./middleware/requireAuth.js";

const FRONTEND_DIST = resolve(findProjectRoot(import.meta.url), "frontend", "dist");

export function startApiServer(): void {
  const app = express();
  // credentials: true (required for the session cookie) can't pair with the wildcard origin, so an
  // explicit origin is needed — same-origin in production (one process serves both frontend and
  // API) and via the Vite dev proxy locally, so this mainly guards a future split-origin deploy.
  app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));
  app.use(express.json());
  app.use("/uploads", express.static(UPLOADS_DIR));

  app.get("/api/health", async (_req, res) => {
    res.json({
      aiConfigured: isGroqConfigured(),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      gmailConfigured: isGmailConfigured(),
      // Single source of truth: backend/reminders/schedulerConfig.ts. The frontend's "Automatic
      // reminders: every N minutes" text (DebtDetail.tsx) reads N from here rather than a
      // hardcoded copy, so changing the real cadence is still a one-line backend change.
      reminderIntervalMinutes: getReminderIntervalMinutes(),
      // The bot's real @username, fetched from Telegram's getMe and cached in memory (see
      // backend/telegram/rawApi.ts) — null if Telegram isn't configured or the call fails. Lets the
      // People page build a real "search @BotUsername" instruction instead of a guessed one.
      botUsername: await getBotUsername(),
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/people", requireAuth, peopleRouter);
  app.use("/api/expenses", requireAuth, expensesRouter);
  app.use("/api/debts", requireAuth, debtsRouter);
  app.use("/api/reminders", requireAuth, remindersRouter);
  app.use("/api/dashboard", requireAuth, dashboardRouter);
  app.use("/api/gmail", requireAuth, gmailRouter);
  app.use("/api/settings", requireAuth, settingsRouter);

  const frontendBuilt = existsSync(FRONTEND_DIST);
  console.error(
    frontendBuilt
      ? `[api] Serving built frontend from ${FRONTEND_DIST}`
      : `[api] No frontend build found at ${FRONTEND_DIST} — "npm run build" must build the frontend before "npm start". Only /api and /uploads routes are available.`
  );
  if (frontendBuilt) {
    app.use(express.static(FRONTEND_DIST));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => {
      res.sendFile(resolve(FRONTEND_DIST, "index.html"));
    });
  }

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled API error:", err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  const port = Number(process.env.PORT) || Number(process.env.API_PORT) || 4000;
  app.listen(port, () => {
    console.error(`[api] Unhinged Debt Collector API listening on http://localhost:${port}`);
  });
}
