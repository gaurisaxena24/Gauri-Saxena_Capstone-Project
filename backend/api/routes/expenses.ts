import { Router } from "express";
import { readFile, unlink } from "node:fs/promises";
import { extname } from "node:path";
import * as agent from "../../../agent/debtCollectorAgent.js";
import * as debtSkill from "../../../skills/debtSkill.js";
import { isGroqConfigured } from "../../ai/groqClient.js";
import { AiNotConfiguredError, AiRequestError } from "../../ai/types.js";
import { uploadImage, uploadPathToUrl } from "../uploads.js";
import type { Expense } from "../../database/database.js";

export const expensesRouter = Router();

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

function toExpensePayload(expense: Expense, extra: { extractionMethod?: "vision" | "ocr" } = {}) {
  return {
    id: expense.id,
    source: expense.source,
    merchant: expense.merchant,
    date: expense.expense_date,
    total: expense.total,
    currency: expense.currency,
    tax: expense.tax,
    tip: expense.tip,
    category: expense.category,
    paymentMethod: expense.payment_method,
    transactionReference: expense.transaction_reference,
    description: expense.description,
    lineItems: expense.line_items_json ? JSON.parse(expense.line_items_json) : [],
    visibleNames: expense.visible_names_json ? JSON.parse(expense.visible_names_json) : [],
    imageUrl: expense.image_path ? uploadPathToUrl(expense.image_path) : null,
    createdAt: expense.created_at,
    ...extra,
  };
}

/** Manual entry — never touches Groq. */
expensesRouter.post("/", (req, res) => {
  const { amount, currency, date, merchant, category, description, paymentMethod, notes } = req.body ?? {};
  const total = Number(amount);
  if (!Number.isFinite(total) || total <= 0) {
    res.status(400).json({ error: "Enter a valid amount greater than 0." });
    return;
  }

  const expense = agent.createManualExpense({
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
      res.status(400).json({ error: uploadError.message || "Couldn't read that image. Try another photo." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No image uploaded." });
      return;
    }

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
      const { extraction, method } = await agent.readImageExpense(imageBuffer, mediaType);

      const expense = agent.createImageExpense({ extraction, method, imagePath: req.file.path });
      res.status(201).json(toExpensePayload(expense, { extractionMethod: method }));
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

expensesRouter.get("/", (_req, res) => {
  res.json({ expenses: debtSkill.listAllExpenses().map((e) => toExpensePayload(e)) });
});

expensesRouter.get("/:id", (req, res) => {
  const expense = debtSkill.getExpenseById(Number(req.params.id));
  if (!expense) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }
  const debts = debtSkill.getDebtsByExpense(expense.id);
  res.json({ ...toExpensePayload(expense), debtIds: debts.map((d) => d.id) });
});

expensesRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = debtSkill.getExpenseById(id);
  if (!existing) {
    res.status(404).json({ error: "Expense not found." });
    return;
  }

  const { merchant, date, total, currency, tax, tip, category, paymentMethod, description, lineItems } =
    req.body ?? {};
  const updated = debtSkill.editExpense(id, {
    merchant: merchant !== undefined ? merchant : undefined,
    expenseDate: date !== undefined ? date : undefined,
    total: total !== undefined ? Number(total) : undefined,
    currency: currency !== undefined ? currency : undefined,
    tax: tax !== undefined ? (tax === null ? null : Number(tax)) : undefined,
    tip: tip !== undefined ? (tip === null ? null : Number(tip)) : undefined,
    category: category !== undefined ? category : undefined,
    paymentMethod: paymentMethod !== undefined ? paymentMethod : undefined,
    description: description !== undefined ? description : undefined,
    lineItems: lineItems !== undefined ? lineItems : undefined,
  });

  res.json(toExpensePayload(updated!));
});
