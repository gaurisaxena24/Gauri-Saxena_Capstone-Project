import { Router } from "express";
import * as reminderSkill from "../../../skills/reminderSkill.js";
import * as profileSkill from "../../../skills/profileSkill.js";

export const remindersRouter = Router();

remindersRouter.get("/", async (_req, res) => {
  const rows = await reminderSkill.allReminders();
  const reminders = await Promise.all(
    rows.map(async (r) => {
      const person = await profileSkill.findPersonById(r.person_id);
      return {
        id: r.id,
        debtId: r.debt_id,
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
