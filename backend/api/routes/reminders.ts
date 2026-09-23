import { Router } from "express";
import * as reminderSkill from "../../../skills/reminderSkill.js";
import * as profileSkill from "../../../skills/profileSkill.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";

export const remindersRouter = Router();

remindersRouter.get("/", async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const rows = await reminderSkill.allReminders(userId);
  const reminders = await Promise.all(
    rows.map(async (r) => {
      const person = await profileSkill.findPersonById(userId, r.person_id);
      return {
        id: r.id,
        debtId: r.debt_id,
        // No standalone debt page exists any more — the frontend links this to the person's
        // profile page instead, which already lists their debt/reminder history.
        personId: person ? r.person_id : null,
        personName: person?.name ?? null,
        message: r.message,
        tone: r.tone,
        status: r.status,
        createdAt: r.created_at,
        sentAt: r.sent_at,
        telegramMessageId: r.telegram_message_id,
      };
    })
  );
  res.json({ reminders });
});
