/**
 * Optional, per-user Google API key. Kept available in Settings because the user wants the option,
 * but nothing in this app currently consumes it — its AI provider is Groq, and Gmail access is
 * OAuth, not a pasted key (see backend/api/routes/gmail.ts). No "Verify" step here: there's no real
 * API to honestly test it against yet. If a future feature ever needs it, it reads this same
 * per-user, encrypted-at-rest column — no separate mechanism to build later.
 */

import { Router } from "express";
import { getUserById, saveGoogleApiKey } from "../../database/database.js";
import { decryptSecret, encryptSecret } from "../../lib/credentialCrypto.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";

export const settingsRouter = Router();

function maskKey(key: string): string {
  const visible = key.slice(-4);
  return `${"•".repeat(Math.max(key.length - 4, 4))}${visible}`;
}

settingsRouter.get("/google-api-key", async (req, res) => {
  const { userId } = req as AuthedRequest;
  const user = await getUserById(userId);
  const configured = Boolean(user?.google_api_key);
  res.json({
    configured,
    maskedKey: configured ? maskKey(decryptSecret(user!.google_api_key!)) : undefined,
  });
});

settingsRouter.post("/google-api-key", async (req, res) => {
  const { userId } = req as AuthedRequest;
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey) {
    // Empty input clears it — this is the only way to remove a saved key, matching Gmail's
    // explicit Disconnect action rather than silently treating a blank save as "leave as-is".
    await saveGoogleApiKey(userId, null);
    res.json({ configured: false });
    return;
  }
  await saveGoogleApiKey(userId, encryptSecret(apiKey));
  res.json({ configured: true, maskedKey: maskKey(apiKey) });
});
