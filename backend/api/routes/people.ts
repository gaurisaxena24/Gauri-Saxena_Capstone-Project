import { Router } from "express";
import * as agent from "../../../agent/debtCollectorAgent.js";
import * as profileSkill from "../../../skills/profileSkill.js";
import * as debtSkill from "../../../skills/debtSkill.js";
import * as reminderSkill from "../../../skills/reminderSkill.js";
import type { Person, PersonWithStats } from "../../database/database.js";

export const peopleRouter = Router();

function toPersonSummary(p: PersonWithStats) {
  return {
    id: p.id,
    name: p.name,
    telegramUsername: p.telegram_username,
    relationship: p.relationship,
    phoneNumber: p.phone_number,
    telegramVerified: Boolean(p.telegram_verified),
    totalOwed: p.total_owed,
    openDebts: p.open_debts,
  };
}

function toPersonPayload(p: Person) {
  return {
    id: p.id,
    name: p.name,
    telegramUsername: p.telegram_username,
    relationship: p.relationship,
    notes: p.notes,
    phoneNumber: p.phone_number,
    telegramVerified: Boolean(p.telegram_verified),
    telegramChatId: p.telegram_chat_id,
    verificationCode: p.verification_code,
  };
}

peopleRouter.get("/", (_req, res) => {
  res.json({ people: profileSkill.listPeople().map(toPersonSummary) });
});

peopleRouter.post("/", (req, res) => {
  const { name, telegramUsername, relationship, notes, phoneNumber } = req.body ?? {};
  if (!name?.trim() || !telegramUsername?.trim()) {
    res.status(400).json({ error: "Name and Telegram username are required." });
    return;
  }

  try {
    const person = profileSkill.addPerson({
      name: name.trim(),
      telegramUsername,
      relationship: relationship?.trim() || undefined,
      notes: notes?.trim() || undefined,
      phoneNumber: phoneNumber?.trim() || undefined,
    });
    res.status(201).json(toPersonPayload(person));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      res.status(409).json({ error: "Someone with that Telegram username already exists." });
      return;
    }
    res.status(500).json({ error: "Could not create person." });
  }
});

function buildPersonDetail(person: Person) {
  const debts = debtSkill.getDebtsByPerson(person.id).map((d) => {
    const expense = debtSkill.getExpenseById(d.expense_id);
    return {
      id: d.id,
      expenseId: d.expense_id,
      amount: d.amount,
      status: d.status,
      createdAt: d.created_at,
      paidAt: d.paid_at,
      merchant: expense?.merchant ?? null,
      category: expense?.category ?? null,
    };
  });

  return {
    ...toPersonPayload(person),
    debts,
    reminders: reminderSkill.historyForPerson(person.id),
  };
}

peopleRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const person = profileSkill.findPersonById(id);
  if (!person) {
    res.status(404).json({ error: "Person not found." });
    return;
  }
  res.json(buildPersonDetail(person));
});

peopleRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, relationship, notes, phoneNumber } = req.body ?? {};
  const updated = profileSkill.editPerson(id, {
    name: name !== undefined ? name : undefined,
    relationship: relationship !== undefined ? relationship : undefined,
    notes: notes !== undefined ? notes : undefined,
    phoneNumber: phoneNumber !== undefined ? phoneNumber : undefined,
  });
  if (!updated) {
    res.status(404).json({ error: "Person not found." });
    return;
  }
  res.json(buildPersonDetail(updated));
});

/**
 * Removes this person and only this person — never their expenses. The database itself enforces
 * that no debt can reference a missing person (a real foreign key), so a debt still drafted
 * against them blocks the delete with a clear message rather than a raw DB error — remove those
 * debts first (via the existing debt-remove action), then this person can go.
 */
peopleRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const attachedDebts = debtSkill.getDebtsByPerson(id);
  if (attachedDebts.length > 0) {
    res.status(409).json({
      error: `${attachedDebts.length} debt(s) are still attached to this person. Remove ${
        attachedDebts.length === 1 ? "it" : "them"
      } first, then you can delete this person.`,
    });
    return;
  }
  const removed = agent.removePerson(id);
  if (!removed) {
    res.status(404).json({ error: "Person not found." });
    return;
  }
  res.status(204).end();
});
