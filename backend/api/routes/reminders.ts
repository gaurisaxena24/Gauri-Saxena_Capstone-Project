import { Router } from "express";
import * as reminderSkill from "../../../skills/reminderSkill.js";
import * as profileSkill from "../../../skills/profileSkill.js";

export const remindersRouter = Router();

remindersRouter.get("/", (_req, res) => {
  const reminders = reminderSkill.allReminders().map((r) => {
    const person = profileSkill.findPersonById(r.person_id);
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
  });
  res.json({ reminders });
});
