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

function toDebtPayload(debt: ExpenseDebt) {
  const expense = debtSkill.getExpenseById(debt.expense_id);
  const person = profileSkill.findPersonById(debt.person_id);
  return {
    id: debt.id,
    expenseId: debt.expense_id,
    personId: debt.person_id,
    personName: person?.name ?? null,
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
  };
}

/** Person + share decision on an existing expense → creates the debt and its cached AI context. */
debtsRouter.post("/", (req, res) => {
  const { expenseId, personId, mode, customAmount } = req.body ?? {};
  try {
    const { debt } = agent.attachPersonToExpense({
      expenseId: Number(expenseId),
      personId: Number(personId),
      mode: mode as ShareMode,
      customAmount: customAmount !== undefined ? Number(customAmount) : undefined,
    });
    res.status(201).json(toDebtPayload(debt));
  } catch (error) {
    if (error instanceof InvalidShareError) {
      res.status(400).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

debtsRouter.get("/", (_req, res) => {
  res.json({ debts: debtSkill.listAllDebts().map(toDebtPayload) });
});

debtsRouter.get("/:id", (req, res) => {
  const debt = debtSkill.getDebt(Number(req.params.id));
  if (!debt) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  const expense = debtSkill.getExpenseById(debt.expense_id);
  const person = profileSkill.findPersonById(debt.person_id);
  res.json({
    ...toDebtPayload(debt),
    context: debt.context_json ? JSON.parse(debt.context_json) : null,
    expense,
    person,
    reminders: reminderSkill.historyForDebt(debt.id),
  });
});

debtsRouter.post("/:id/generate-message", async (req, res) => {
  const debt = debtSkill.getDebt(Number(req.params.id));
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
    res.json({ ...toDebtPayload(updated), reasoning });
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

debtsRouter.patch("/:id/message", (req, res) => {
  const debt = debtSkill.getDebt(Number(req.params.id));
  if (!debt) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  }
  const updated = agent.editDraft(debt.id, message);
  res.json(toDebtPayload(updated!));
});

debtsRouter.post("/:id/send", async (req, res) => {
  const debt = debtSkill.getDebt(Number(req.params.id));
  if (!debt) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  const person = profileSkill.findPersonById(debt.person_id);
  if (!person) {
    res.status(400).json({ error: "This debt has no linked person." });
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

debtsRouter.post("/:id/paid", (req, res) => {
  const updated = agent.markDebtPaid(Number(req.params.id));
  if (!updated) {
    res.status(404).json({ error: "Debt not found." });
    return;
  }
  res.json(toDebtPayload(updated));
});
