import { Router } from "express";
import { readFile, unlink } from "node:fs/promises";
import { extname } from "node:path";
import * as agent from "../../../agent/debtCollectorAgent.js";
import * as debtSkill from "../../../skills/debtSkill.js";
import * as profileSkill from "../../../skills/profileSkill.js";
import * as reminderSkill from "../../../skills/reminderSkill.js";
import { isGroqConfigured } from "../../ai/groqClient.js";
import { AiNotConfiguredError, AiRequestError } from "../../ai/types.js";
import { uploadImage, uploadPathToUrl } from "../uploads.js";
import type { Expense, ExpenseDebt } from "../../database/database.js";

export const expensesRouter = Router();

const DEBUG = process.env.NODE_ENV !== "production";
function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log("[expense-extract]", ...args);
}

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

function toExpensePayload(
  expense: Expense,
  extra: { extractionMethod?: "vision" | "ocr"; extractionFailed?: boolean } = {}
) {
  return {
    id: expense.id,
    source: expense.source,
    merchant: expense.merchant,
    date: expense.expense_date,
    total: expense.total,
    currency: expense.currency,
    subtotal: expense.subtotal,
    tax: expense.tax,
    tip: expense.tip,
    serviceCharge: expense.service_charge,
    discount: expense.discount,
    category: expense.category,
    paymentMethod: expense.payment_method,
    transactionReference: expense.transaction_reference,
    description: expense.description,
    lineItems: expense.line_items_json ? JSON.parse(expense.line_items_json) : [],
    visibleNames: expense.visible_names_json ? JSON.parse(expense.visible_names_json) : [],
    imageUrl: expense.image_path ? uploadPathToUrl(expense.image_path) : null,
    confidence: expense.extraction_confidence,
    createdAt: expense.created_at,
    ...extra,
  };
}

/** Manual entry — never touches Groq. */
expensesRouter.post("/", async (req, res) => {
  const { amount, currency, date, merchant, category, description, paymentMethod, notes } = req.body ?? {};
  const total = Number(amount);
  if (!Number.isFinite(total) || total <= 0) {
    res.status(400).json({ error: "Enter a valid amount greater than 0." });
    return;
  }

  const expense = await agent.createManualExpense({
    amount: total,
    currency: currency || "INR",
    date: date || null,
    merchant: merchant || null,
    category: category || null,
    description: description || null,
    paymentMethod: paymentMethod || null,
    notes: notes || null,
  });

  res.status(201).json(toExpensePayload(expense));
});

/** Image entry — Groq Vision if configured/available, else automatic OCR fallback. Never fakes a result. */
expensesRouter.post("/extract", (req, res) => {
  uploadImage.single("image")(req, res, async (uploadError) => {
    if (uploadError) {
      debugLog("multer/upload rejected the request:", uploadError.message);
      res.status(400).json({ error: uploadError.message || "Couldn't read that image. Try another photo." });
      return;
    }
    if (!req.file) {
      debugLog("no `image` field found on the request — file never reached the backend");
      res.status(400).json({ error: "No image uploaded." });
      return;
    }
    debugLog(`upload received: originalname=${req.file.originalname}, mimetype=${req.file.mimetype}, size=${req.file.size} bytes`);

    const cleanupUpload = () => unlink(req.file!.path).catch(() => {});

    if (!isGroqConfigured()) {
      await cleanupUpload();
      res.status(503).json({
        error: "GROQ_API_KEY is not configured. Add it to your .env file to enable image reading.",
        aiNotConfigured: true,
      });
      return;
    }

    try {
      const imageBuffer = await readFile(req.file.path);
      const mediaType = EXT_TO_MIME[extname(req.file.path).toLowerCase()] ?? req.file.mimetype;
      debugLog(`resolved mediaType=${mediaType} (from extension, falling back to multer's reported mimetype)`);
      const { extraction, method, extractionFailed } = await agent.readImageExpense(imageBuffer, mediaType);
      debugLog(`extraction done via ${method}, extractionFailed=${Boolean(extractionFailed)}, items=${extraction.lineItems.length}`);

      const expense = await agent.createImageExpense({ extraction, method, imagePath: req.file.path });
      res.status(201).json(toExpensePayload(expense, { extractionMethod: method, extractionFailed }));
    } catch (error) {
      await cleanupUpload();
      if (error instanceof AiNotConfiguredError) {
        res.status(503).json({ error: error.message, aiNotConfigured: true });
        return;
      }
      if (error instanceof AiRequestError) {
        console.error("Expense image reading failed:", error.message);
        res.status(502).json({ error: `Couldn't read that image: ${error.message}` });
        return;
      }
      console.error("Expense image reading failed:", error);
      res.status(500).json({ error: "Couldn't read that image. Try another photo." });
    }
  });
});

expensesRouter.get("/", async (_req, res) => {
  const expenses = await debtSkill.listAllExpenses();
  res.json({ expenses: expenses.map((e) => toExpensePayload(e)) });
});

/**
 * Full inline detail for each person/debt this expense was split into — there is no standalone
 * debt page any more (see Expenses.tsx, which renders this nested directly under its expense
 * instead of navigating anywhere): amount, paid/unpaid status, the generated reminder message, and
 * the full send history all live here, one level down from the expense they belong to.
 */
async function toExpenseDebtDetail(debt: ExpenseDebt) {
  const [person, reminders] = await Promise.all([
    profileSkill.findPersonById(debt.person_id),
    reminderSkill.historyForDebt(debt.id),
  ]);
  return {
    id: debt.id,
    personId: person ? debt.person_id : null,
    personName: person?.name ?? null,
    amount: debt.amount,
    currency: debt.currency,
    status: debt.status,
    message: debt.message,
    tone: debt.tone,
    messageEdited: Boolean(debt.message_edited),
    createdAt: debt.created_at,
    paidAt: debt.paid_at,
    // reminderSkill.historyForDebt returns raw DB rows (snake_case) — mapped to match the same
    // camelCase shape GET /reminders already returns, which the frontend's ReminderSummary expects.
    reminders: reminders.map((r) => ({
      id: r.id,
      debtId: r.debt_id,
      personId: debt.person_id,
      personName: person?.name ?? null,
      message: r.message,
      tone: r.tone,
      status: r.status,
      createdAt: r.created_at,
      sentAt: r.sent_at,
      telegramMessageId: r.telegram_message_id,
    })),
  };
}

expensesRouter.get("/:id", async (req, res) => {
  const expense = await debtSkill.getExpenseById(Number(req.params.id));
  if (!expense) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }
  const debts = await debtSkill.getDebtsByExpense(expense.id);
  res.json({ ...toExpensePayload(expense), debts: await Promise.all(debts.map(toExpenseDebtDetail)) });
});

expensesRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await debtSkill.getExpenseById(id);
  if (!existing) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }

  const {
    merchant,
    date,
    total,
    currency,
    subtotal,
    tax,
    tip,
    serviceCharge,
    discount,
    category,
    paymentMethod,
    description,
    lineItems,
  } = req.body ?? {};
  const updated = await debtSkill.editExpense(id, {
    merchant: merchant !== undefined ? merchant : undefined,
    expenseDate: date !== undefined ? date : undefined,
    total: total !== undefined ? Number(total) : undefined,
    currency: currency !== undefined ? currency : undefined,
    subtotal: subtotal !== undefined ? (subtotal === null ? null : Number(subtotal)) : undefined,
    tax: tax !== undefined ? (tax === null ? null : Number(tax)) : undefined,
    tip: tip !== undefined ? (tip === null ? null : Number(tip)) : undefined,
    serviceCharge: serviceCharge !== undefined ? (serviceCharge === null ? null : Number(serviceCharge)) : undefined,
    discount: discount !== undefined ? (discount === null ? null : Number(discount)) : undefined,
    category: category !== undefined ? category : undefined,
    paymentMethod: paymentMethod !== undefined ? paymentMethod : undefined,
    description: description !== undefined ? description : undefined,
    lineItems: lineItems !== undefined ? lineItems : undefined,
  });

  res.json(toExpensePayload(updated!));
});

/**
 * Removes this expense and only this expense — never the person. The database itself enforces
 * that no debt can reference a missing expense (a real foreign key), so a debt still drafted
 * against this expense blocks the delete with a clear message rather than a raw DB error —
 * remove those debts first (via the existing debt-remove action), then this expense can go.
 * Best-effort deletes the uploaded image file, if any.
 */
expensesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const attachedDebts = await debtSkill.getDebtsByExpense(id);
  if (attachedDebts.length > 0) {
    res.status(409).json({
      error: `This expense has ${attachedDebts.length} debt(s) still attached. Remove ${
        attachedDebts.length === 1 ? "it" : "them"
      } first, then you can delete this expense.`,
    });
    return;
  }
  const removed = await agent.removeExpense(id);
  if (!removed) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }
  if (removed.imagePath) await unlink(removed.imagePath).catch(() => {});
  res.status(204).end();
});
