/**
 * Encrypts secrets (currently: the Gmail OAuth refresh token) before they touch the database, and
 * signs/verifies the Gmail OAuth `state` param. This is the first secret this app has ever stored
 * at rest — every other credential (GROQ_API_KEY, TELEGRAM_BOT_TOKEN) is a plain env var read at
 * point of use — so this introduces AES-256-GCM via Node's built-in `crypto`, no new dependency.
 *
 * `CREDENTIAL_ENCRYPTION_KEY` is one 32-byte (base64) master key set by the operator (see
 * .env.example). Two purpose-specific keys are derived from it via HMAC-SHA256 so the same master
 * key isn't reused for two different jobs (encrypting tokens vs. signing OAuth state).
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const IV_LENGTH = 12; // GCM-recommended IV size
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

let masterKey: Buffer | undefined;

function getMasterKey(): Buffer {
  if (masterKey) return masterKey;
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it (see .env.example)."
    );
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${decoded.length}). Generate one with \`openssl rand -base64 32\`.`
    );
  }
  masterKey = decoded;
  return masterKey;
}

function deriveKey(purpose: string): Buffer {
  return createHmac("sha256", getMasterKey()).update(purpose).digest();
}

/** Lets a route check upfront and return a clean error instead of `encryptSecret`/`decryptSecret`
 * throwing mid-request when the operator hasn't set CREDENTIAL_ENCRYPTION_KEY yet. */
export function isCredentialEncryptionConfigured(): boolean {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  return Boolean(raw && Buffer.from(raw, "base64").length === 32);
}

/** Encrypts a plaintext secret. Output is safe to store as a single TEXT column value. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey("gmail-token-encryption");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypts a value previously produced by `encryptSecret`. Throws if the payload was tampered with. */
export function decryptSecret(payload: string): string {
  const key = deriveKey("gmail-token-encryption");
  const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted payload.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Stateless, self-verifying OAuth `state` param — deliberately not a shared in-memory variable,
 * which would race with itself if "Connect Gmail" were clicked twice or opened in two tabs, and
 * wouldn't survive a server restart mid-flow. Google's own redirect_uri allowlist is the primary
 * defense against a forged callback; this just rejects a stale or tampered `state`.
 */
export function signState(): string {
  const key = deriveKey("gmail-oauth-state");
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", key).update(timestamp).digest("base64url");
  return `${timestamp}.${signature}`;
}

export function verifyState(state: string | undefined): boolean {
  if (!state) return false;
  const [timestamp, signature] = state.split(".");
  if (!timestamp || !signature) return false;
  const key = deriveKey("gmail-oauth-state");
  const expected = createHmac("sha256", key).update(timestamp).digest("base64url");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return false;
  const age = Date.now() - Number(timestamp);
  return age >= 0 && age <= STATE_MAX_AGE_MS;
}
