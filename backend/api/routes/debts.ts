import { Router } from "express";
import * as agent from "../../../agent/debtCollectorAgent.js";
import * as debtSkill from "../../../skills/debtSkill.js";
import * as profileSkill from "../../../skills/profileSkill.js";
import * as reminderSkill from "../../../skills/reminderSkill.js";
import { InvalidShareError, type ShareMode } from "../../../skills/debtCalculationSkill.js";
import { TelegramNotVerifiedError } from "../../../skills/telegramSkill.js";
import { AiNotConfiguredError, AiRequestError, TONES, type Tone } from "../../ai/types.js";
import { isGroqConfigured } from "../../ai/groqClient.js";
import type { ExpenseDebt } from "../../database/database.js";

export const debtsRouter = Router();

function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}

async function toDebtPayload(debt: ExpenseDebt) {
  const [expense, person] = await Promise.all([
    debtSkill.getExpenseById(debt.expense_id),
    profileSkill.findPersonById(debt.person_id),
  ]);
  return {
    id: debt.id,
    expenseId: debt.expense_id,
    personId: debt.person_id,
    personName: person?.name ?? null,
    personExists: Boolean(person),
    expenseExists: Boolean(expense),
    amount: debt.amount,
    currency: debt.currency,
    status: debt.status,
    message: debt.message,
    tone: debt.tone,
    messageEdited: Boolean(debt.message_edited),
    createdAt: debt.created_at,
    paidAt: debt.paid_at,
    expenseMerchant: expense?.merchant ?? null,
    expenseCategory: expense?.category ?? null,
    shareMode: debt.share_mode,
    additionalContext: debt.additional_context,
    desiredAction: debt.desired_action,
    selectedItems: debt.selected_items_json ? JSON.parse(debt.selected_items_json) : null,
  };
}

function isSelectedItems(value: unknown): value is Array<{ name: string; amount: number }> {
  return (
    Array.isArray(value) &&
    value.every(
      (v) => v && typeof v === "object" && typeof v.name === "string" && typeof v.amount === "number"
    )
  );
}

/** Person + share decision on an existing expense → creates the debt and its cached AI context. */
debtsRouter.post("/", async (req, res) => {
  const { expenseId, personId, mode, customAmount, additionalContext, desiredAction, selectedItems } =
    req.body ?? {};
  try {
    const { debt } = await agent.attachPersonToExpense({
      expenseId: Number(expenseId),
      personId: Number(personId),
      mode: mode as ShareMode,
      customAmount: customAmount !== undefined ? Number(customAmount) : undefined,
      additionalContext: additionalContext ?? null,
      desiredAction: desiredAction ?? null,
      selectedItems: isSelectedItems(selectedItems) ? selectedItems : null,
    });
    res.status(201).json(await toDebtPayload(debt));
  } catch (error) {
    if (error instanceof InvalidShareError) {
      res.status(400).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

debtsRouter.get("/", async (_req, res) => {
  const debts = await debtSkill.listAllDebts();
  res.json({ debts: await Promise.all(debts.map(toDebtPayload)) });
});

debtsRouter.get("/:id", async (req, res) => {
  const debt = await debtSkill.getDebt(Number(req.params.id));
  if (!debt) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  const [payload, expense, person, reminders] = await Promise.all([
    toDebtPayload(debt),
    debtSkill.getExpenseById(debt.expense_id),
    profileSkill.findPersonById(debt.person_id),
    reminderSkill.historyForDebt(debt.id),
  ]);
  res.json({
    ...payload,
    context: debt.context_json ? JSON.parse(debt.context_json) : null,
    expense,
    person,
    reminders,
  });
});

debtsRouter.post("/:id/generate-message", async (req, res) => {
  const debt = await debtSkill.getDebt(Number(req.params.id));
  if (!debt) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  if (!debt.context_json) {
    res.status(400).json({ error: "This debt has no context to generate from." });
    return;
  }
  if (!isGroqConfigured()) {
    res.status(503).json({ error: "GROQ_API_KEY is not configured.", aiNotConfigured: true });
    return;
  }

  const { tone, regenerate } = req.body ?? {};
  const forcedTone = isTone(tone) ? tone : isTone(debt.tone) ? debt.tone : undefined;

  try {
    const { debt: updated, reasoning } = await agent.generateDraft({
      debt,
      context: JSON.parse(debt.context_json),
      forcedTone,
      regenerate: Boolean(regenerate),
    });
    res.json({ ...(await toDebtPayload(updated)), reasoning });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      res.status(503).json({ error: error.message, aiNotConfigured: true });
      return;
    }
    if (error instanceof AiRequestError) {
      console.error("Message generation failed:", error.message);
      res.status(502).json({ error: `Message generation failed: ${error.message}` });
      return;
    }
    console.error("Message generation failed:", error);
    res.status(500).json({ error: "Message generation failed. Try again." });
  }
});

debtsRouter.patch("/:id/message", async (req, res) => {
  const debt = await debtSkill.getDebt(Number(req.params.id));
  if (!debt) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  }
  const updated = await agent.editDraft(debt.id, message);
  res.json(await toDebtPayload(updated!));
});

debtsRouter.post("/:id/send", async (req, res) => {
  const debt = await debtSkill.getDebt(Number(req.params.id));
  if (!debt) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  const person = await profileSkill.findPersonById(debt.person_id);
  if (!person) {
    res.status(400).json({ error: "This debt has no linked person." });
    return;
  }

  // Idempotency guard against a genuine double-send (two rapid clicks, two tabs, a retried
  // request) — the database, not just the frontend's disabled-button state, is the source of
  // truth for whether this debt has already been sent.
  const history = await reminderSkill.historyForDebt(debt.id);
  const alreadySent = history.some((r) => r.status === "SENT");
  if (alreadySent) {
    res.json({ success: true, note: "Already sent via Telegram." });
    return;
  }

  try {
    const result = await agent.sendReminder(debt, person);
    if (!result.success) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ success: true, note: "Sent via Telegram." });
  } catch (error) {
    if (error instanceof TelegramNotVerifiedError) {
      res.status(403).json({ error: error.message, notVerified: true });
      return;
    }
    const message = error instanceof Error ? error.message : "Couldn't send via Telegram.";
    res.status(400).json({ error: message });
  }
});

debtsRouter.post("/:id/paid", async (req, res) => {
  const updated = await agent.markDebtPaid(Number(req.params.id));
  if (!updated) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  res.json(await toDebtPayload(updated));
});

/** Removes this debt ("send request") and its own send-history only — never the person or expense it references. */
debtsRouter.delete("/:id", async (req, res) => {
  const removed = await agent.removeDebt(Number(req.params.id));
  if (!removed) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  res.status(204).end();
});
