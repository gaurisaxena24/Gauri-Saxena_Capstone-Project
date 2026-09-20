import { Router } from "express";
import * as agent from "../../../agent/debtCollectorAgent.js";
import * as profileSkill from "../../../skills/profileSkill.js";
import * as debtSkill from "../../../skills/debtSkill.js";
import * as reminderSkill from "../../../skills/reminderSkill.js";
import { verifyPersonByCode, type Person, type PersonWithStats } from "../../database/database.js";
import { sendTelegramMessage } from "../../tools/sendTelegramMessage.js";

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

peopleRouter.get("/", async (_req, res) => {
  const people = await profileSkill.listPeople();
  res.json({ people: people.map(toPersonSummary) });
});

peopleRouter.post("/", async (req, res) => {
  const { name, telegramUsername, relationship, notes, phoneNumber } = req.body ?? {};
  if (!name?.trim() || !telegramUsername?.trim()) {
    res.status(400).json({ error: "Name and Telegram username are required." });
    return;
  }

  try {
    const person = await profileSkill.addPerson({
      name: name.trim(),
      telegramUsername,
      relationship: relationship?.trim() || undefined,
      notes: notes?.trim() || undefined,
      phoneNumber: phoneNumber?.trim() || undefined,
    });
    res.status(201).json(toPersonPayload(person));
  } catch (error) {
    // Postgres reports a unique-violation as error code 23505 (was a "UNIQUE constraint failed"
    // message match under the previous SQLite driver).
    if ((error as { code?: string } | null)?.code === "23505") {
      res.status(409).json({ error: "Someone with that Telegram username already exists." });
      return;
    }
    res.status(500).json({ error: "Could not create person." });
  }
});

async function buildPersonDetail(person: Person) {
  const debtRows = await debtSkill.getDebtsByPerson(person.id);
  const debts = await Promise.all(
    debtRows.map(async (d) => {
      const expense = await debtSkill.getExpenseById(d.expense_id);
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
    })
  );

  return {
    ...toPersonPayload(person),
    debts,
    reminders: await reminderSkill.historyForPerson(person.id),
  };
}

peopleRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const person = await profileSkill.findPersonById(id);
  if (!person) {
    res.status(404).json({ error: "Person not found." });
    return;
  }
  res.json(await buildPersonDetail(person));
});

/**
 * Local-testing-only verification path: normal verification requires the Telegram poller to
 * actually receive a real incoming message, but the poller can only run on one instance at a time
 * (see backend/index.ts's shouldPollTelegram) and the deployed Railway instance already holds that
 * connection, so local dev has no way to receive a real inbound message right now. Rather than
 * trusting a claimed chat ID and flipping `telegram_verified` blind, this proves the chat ID is
 * real and reachable the same way normal verification does: it sends this person's real
 * verification code to that chat right now, and only marks them verified if Telegram actually
 * accepts and delivers it. Never invents a "verified" state for a chat ID that can't really
 * receive a message.
 *
 * Explicitly disabled on the deployed Railway instance (same RAILWAY_ENVIRONMENT check as
 * shouldPollTelegram/shouldRunReminderScheduler in backend/index.ts): with no auth on this API,
 * leaving this reachable in production would let anyone who knows a person's id redirect their
 * real Telegram verification to an arbitrary chat ID of the caller's choosing.
 */
peopleRouter.post("/:id/verify-manually", async (req, res) => {
  if (process.env.RAILWAY_ENVIRONMENT) {
    res.status(403).json({ error: "Manual verification is disabled on the deployed instance; only local dev can use it." });
    return;
  }
  const id = Number(req.params.id);
  const { chatId } = req.body ?? {};
  if (!chatId) {
    res.status(400).json({ error: "chatId is required." });
    return;
  }
  const person = await profileSkill.findPersonById(id);
  if (!person) {
    res.status(404).json({ error: "Person not found." });
    return;
  }
  const sendResult = await sendTelegramMessage({
    chatId,
    message: `This confirms ${person.name}'s local test verification for Unhinged Debt Collector (code ${person.verification_code}).`,
    confirm: true,
  });
  if (!sendResult.success) {
    res.status(502).json({ error: `Could not deliver to that chat, so this person was NOT marked verified: ${sendResult.message}` });
    return;
  }
  const verified = await verifyPersonByCode(person.verification_code, chatId, chatId);
  if (!verified) {
    res.status(500).json({ error: "Message delivered, but the verification code lookup failed unexpectedly." });
    return;
  }
  res.json(await buildPersonDetail(verified));
});

peopleRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, relationship, notes, phoneNumber } = req.body ?? {};
  const updated = await profileSkill.editPerson(id, {
    name: name !== undefined ? name : undefined,
    relationship: relationship !== undefined ? relationship : undefined,
    notes: notes !== undefined ? notes : undefined,
    phoneNumber: phoneNumber !== undefined ? phoneNumber : undefined,
  });
  if (!updated) {
    res.status(404).json({ error: "Person not found." });
    return;
  }
  res.json(await buildPersonDetail(updated));
});

/**
 * Removes this person and only this person — never their expenses. The database itself enforces
 * that no debt can reference a missing person (a real foreign key), so a debt still drafted
 * against them blocks the delete with a clear message rather than a raw DB error — remove those
 * debts first (via the existing debt-remove action), then this person can go.
 */
peopleRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const attachedDebts = await debtSkill.getDebtsByPerson(id);
  if (attachedDebts.length > 0) {
    res.status(409).json({
      error: `${attachedDebts.length} debt(s) are still attached to this person. Remove ${
        attachedDebts.length === 1 ? "it" : "them"
      } first, then you can delete this person.`,
    });
    return;
  }
  const removed = await agent.removePerson(id);
  if (!removed) {
    res.status(404).json({ error: "Person not found." });
    return;
  }
  res.status(204).end();
});
