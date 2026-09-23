/**
 * Connects a user's own Gmail account via Google OAuth (read-only) and stores the resulting
 * credential against *their* row, keyed by the real per-request session (see requireAuth.ts) —
 * each app-user's connection lives only on their own `users` row, read/written only via their own
 * `userId`, never a shared or global credential.
 *
 * Google Cloud Console's OAuth consent screen, kept in "Testing" mode with each real user added as
 * a test user, is still the outer access boundary Google itself enforces — that also means refresh
 * tokens expire after ~7 days in Testing mode, so periodic reconnects are expected.
 */

import { Router } from "express";
import { clearGmailConnection, getUserById, saveGmailConnection } from "../../database/database.js";
import { decryptSecret, encryptSecret, signState, verifyState } from "../../lib/credentialCrypto.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";

export const gmailRouter = Router();

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function isGmailConfigured(): boolean {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    return false;
  }
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  return Boolean(key && Buffer.from(key, "base64").length === 32);
}

/** Where the browser lands after the OAuth round trip. Express doesn't serve the frontend at all
 * in dev (see server.ts), so a relative redirect 404s there — FRONTEND_URL fixes that in dev only
 * and is left unset in production, where a relative path is correct (one process serves both). */
function settingsRedirect(query: string): string {
  const base = process.env.FRONTEND_URL ?? "";
  return `${base}/settings?${query}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  return res.json();
}

/** Exported for reuse by the background payment scanner (backend/gmail/paymentScanner.ts). */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(`Token refresh failed (${res.status})`) as Error & { invalidGrant?: boolean };
    err.invalidGrant = body?.error === "invalid_grant";
    throw err;
  }
  return res.json();
}

/** Also doubles as the "does this token actually work" check — not just a format check. */
async function fetchGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail profile fetch failed (${res.status})`);
  return res.json();
}

gmailRouter.get("/connect", async (req, res) => {
  if (!isGmailConfigured()) {
    res.status(500).json({ error: "Gmail isn't configured on the server yet." });
    return;
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("access_type", "offline");
  // Forces Google to re-issue a refresh_token every time (not just on first-ever consent), which
  // we want since every successful callback overwrites the stored token unconditionally.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", signState());
  res.redirect(url.toString());
});

gmailRouter.get("/callback", async (req, res) => {
  try {
    const code = String(req.query.code ?? "");
    const state = req.query.state ? String(req.query.state) : undefined;
    if (!verifyState(state)) throw new Error("Invalid or expired OAuth state.");
    if (!code) throw new Error("Google did not return an authorization code.");

    // Google's redirect back here is a top-level GET navigation, so the browser still sends our
    // own SameSite=Lax session cookie — requireAuth (mounted on this whole router) already
    // resolved it to the same user who started the /connect flow.
    const { userId } = req as AuthedRequest;

    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Leaves any existing stored connection untouched rather than nulling it out over nothing.
      throw new Error("Google did not return a refresh token.");
    }

    const profile = await fetchGmailProfile(tokens.access_token);
    await saveGmailConnection(userId, {
      email: profile.emailAddress,
      encryptedRefreshToken: encryptSecret(tokens.refresh_token),
    });

    res.redirect(settingsRedirect("gmail=connected"));
  } catch (error) {
    console.error("Gmail OAuth callback failed:", error);
    res.redirect(settingsRedirect("gmail=error"));
  }
});

gmailRouter.get("/status", async (req, res) => {
  const { userId } = req as AuthedRequest;
  const user = await getUserById(userId);
  const connected = Boolean(user?.gmail_refresh_token);
  res.json({
    connected,
    emailAddress: connected ? user!.gmail_email : undefined,
    connectedAt: connected ? user!.gmail_connected_at : undefined,
  });
});

// Always responds 200 — verified:false is an expected, non-exceptional outcome (not connected,
// reconnect required, Google temporarily unavailable), not an HTTP error.
gmailRouter.post("/verify", async (req, res) => {
  const { userId } = req as AuthedRequest;
  const user = await getUserById(userId);
  if (!user?.gmail_refresh_token) {
    res.json({ verified: false, reason: "not_connected" });
    return;
  }
  try {
    const refreshToken = decryptSecret(user.gmail_refresh_token);
    const tokens = await refreshAccessToken(refreshToken);
    const profile = await fetchGmailProfile(tokens.access_token);
    res.json({ verified: true, emailAddress: profile.emailAddress });
  } catch (error) {
    const invalidGrant = (error as { invalidGrant?: boolean } | null)?.invalidGrant;
    console.error("Gmail verify failed:", error);
    res.json({ verified: false, reason: invalidGrant ? "reconnect_required" : "unavailable" });
  }
});

gmailRouter.post("/disconnect", async (req, res) => {
  const { userId } = req as AuthedRequest;
  const user = await getUserById(userId);
  if (user?.gmail_refresh_token) {
    try {
      const refreshToken = decryptSecret(user.gmail_refresh_token);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: "POST",
      });
    } catch (error) {
      // Best-effort — never blocks clearing the local connection.
      console.error("Gmail token revoke failed (clearing local connection anyway):", error);
    }
    await clearGmailConnection(userId);
  }
  res.json({ connected: false });
});
