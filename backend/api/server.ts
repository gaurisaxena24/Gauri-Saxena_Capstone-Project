import express from "express";
import cors from "cors";
import { UPLOADS_DIR } from "../database/database.js";
import { isGroqConfigured } from "../ai/groqClient.js";
import { authRouter } from "./routes/auth.js";
import { peopleRouter } from "./routes/people.js";
import { expensesRouter } from "./routes/expenses.js";
import { debtsRouter } from "./routes/debts.js";
import { remindersRouter } from "./routes/reminders.js";
import { dashboardRouter } from "./routes/dashboard.js";

export function startApiServer(): void {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/uploads", express.static(UPLOADS_DIR));

  app.get("/api/health", (_req, res) => {
    res.json({
      aiConfigured: isGroqConfigured(),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/people", peopleRouter);
  app.use("/api/expenses", expensesRouter);
  app.use("/api/debts", debtsRouter);
  app.use("/api/reminders", remindersRouter);
  app.use("/api/dashboard", dashboardRouter);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled API error:", err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  const port = Number(process.env.PORT) || Number(process.env.API_PORT) || 4000;
  app.listen(port, () => {
    console.error(`[api] Unhinged Debt Collector API listening on http://localhost:${port}`);
  });
}
