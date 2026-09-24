import { AiNotConfiguredError, AiRequestError } from "./types.js";
import { callClaude, isClaudeConfigured } from "./claudeClient.js";

const BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_TEXT_MODEL = "openai/gpt-oss-120b";

export function getGroqApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new AiNotConfiguredError();
  return key;
}

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/** Only set if the account actually has a vision-capable model — see backend/ai/expenseReader.ts. */
export function getVisionModel(): string | undefined {
  return process.env.GROQ_VISION_MODEL || undefined;
}

function getTextModel(): string {
  return process.env.GROQ_TEXT_MODEL || DEFAULT_TEXT_MODEL;
}

/**
 * App-wide Groq pause. When Groq answers 429 (e.g. the daily token limit is used up), every caller —
 * the reminder scheduler, message generation, thank-you messages, expense reading, the Gmail AI
 * fallback — stops hitting Groq until the wait Groq itself asked for has passed, and fails
 * instantly instead. Without this, the reminder scheduler retried the same debt every few seconds
 * and re-drained the daily budget the moment any of it freed up.
 */
let cooldownUntilMs = 0;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

/** Reads Groq's own wait from a 429: "Please try again in 7m26.4s" / "1h2m" / "11.99s" / "450ms",
 * else the Retry-After header (seconds). Null if neither says. */
export function parseGroqRetryDelayMs(message: string, retryAfterHeader?: string | null): number | null {
  const match = message.match(/try again in\s+((?:[\d.]+(?:h|ms|m|s))+)/i);
  if (match) {
    let ms = 0;
    for (const [, value, unit] of match[1].matchAll(/([\d.]+)(h|ms|m|s)/gi)) {
      const n = Number(value);
      ms += unit === "h" ? n * 3_600_000 : unit === "m" ? n * 60_000 : unit === "s" ? n * 1_000 : n;
    }
    if (ms > 0) return Math.ceil(ms);
  }
  const header = Number(retryAfterHeader);
  return Number.isFinite(header) && header > 0 ? header * 1_000 : null;
}

/** How long until Groq may be called again (0 if not paused). */
export function groqCooldownRemainingMs(): number {
  return Math.max(0, cooldownUntilMs - Date.now());
}

async function callChat(params: {
  model: string;
  system: string;
  userContent: unknown;
  maxTokens?: number;
  /**
   * Only meaningful for reasoning models (e.g. openai/gpt-oss-*), which spend
   * an unbounded, hidden chain-of-thought budget out of `max_tokens` before
   * emitting any actual content. Left unset, existing callers (message
   * generation) are completely unaffected. Passed explicitly by callers that
   * need the JSON payload to reliably fit within max_tokens — see
   * skills/expenseReaderSkill.ts.
   */
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<string> {
  const apiKey = getGroqApiKey();

  const pausedMs = groqCooldownRemainingMs();
  if (pausedMs > 0) {
    // Same "rate limit ... try again in Ns" wording Groq uses, so existing rate-limit handling
    // (skills/messageDraftSkill.ts) recognizes it — but no request is actually sent.
    throw new AiRequestError(`Groq rate limit reached — AI is paused. Please try again in ${Math.ceil(pausedMs / 1000)}s.`);
  }

  if (process.env.NODE_ENV !== "production") {
    const contentKind = Array.isArray(params.userContent) ? "multimodal (text + image)" : "text";
    console.log(`[groq] requesting model=${params.model} content=${contentKind} maxTokens=${params.maxTokens ?? 1024}`);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 1024,
        ...(params.reasoningEffort ? { reasoning_effort: params.reasoningEffort } : {}),
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (error) {
    throw new AiRequestError(`Could not reach Groq: ${error instanceof Error ? error.message : error}`);
  }

  const rawBody = await response.text();
  let data: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } | string } = {};
  try {
    data = JSON.parse(rawBody);
  } catch {
    // fall through; rawBody used below for a raw error message
  }

  if (!response.ok) {
    const message =
      typeof data.error === "string" ? data.error : (data.error?.message ?? rawBody.slice(0, 300));
    console.error(`[Groq] ${response.status} response body:`, rawBody.slice(0, 1000));
    if (response.status === 429) {
      const waitMs = parseGroqRetryDelayMs(message ?? "", response.headers.get("retry-after")) ?? DEFAULT_RATE_LIMIT_WAIT_MS;
      cooldownUntilMs = Math.max(cooldownUntilMs, Date.now() + waitMs);
      console.error(`[Groq] Rate-limited — pausing all Groq calls for ${Math.ceil(waitMs / 1000)}s.`);
    }
    throw new AiRequestError(message || `Groq returned ${response.status}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new AiRequestError("Groq returned no content.");
  return text;
}

/**
 * Runs a Groq call, and if it fails for any AI-side reason (daily token limit / app-wide pause,
 * outage, bad response, missing key) re-sends the same request to Claude (backend/ai/claudeClient.ts)
 * when ANTHROPIC_API_KEY is set. Without it, the Groq error is thrown exactly as before.
 */
async function withClaudeBackup(
  groqCall: () => Promise<string>,
  claudeRequest: Parameters<typeof callClaude>[0]
): Promise<string> {
  try {
    return await groqCall();
  } catch (error) {
    const aiSideFailure = error instanceof AiRequestError || error instanceof AiNotConfiguredError;
    if (!aiSideFailure || !isClaudeConfigured()) throw error;
    console.warn(`[ai] Groq unavailable (${(error as Error).message.slice(0, 120)}) — using Claude backup.`);
    return callClaude(claudeRequest);
  }
}

/** True if at least one AI provider can take a request right now (Groq not paused, or Claude set up). */
export function isAiAvailableNow(): boolean {
  return groqCooldownRemainingMs() === 0 || isClaudeConfigured();
}

export function callGroqText(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<string> {
  return withClaudeBackup(
    () =>
      callChat({
        model: getTextModel(),
        system: params.system,
        userContent: params.prompt,
        maxTokens: params.maxTokens,
        reasoningEffort: params.reasoningEffort,
      }),
    { system: params.system, prompt: params.prompt }
  );
}

export function callGroqVision(params: {
  model: string;
  system: string;
  prompt: string;
  imageBase64: string;
  mediaType: string;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<string> {
  return withClaudeBackup(
    () =>
      callChat({
        model: params.model,
        system: params.system,
        maxTokens: params.maxTokens,
        reasoningEffort: params.reasoningEffort,
        userContent: [
          { type: "text", text: params.prompt },
          { type: "image_url", image_url: { url: `data:${params.mediaType};base64,${params.imageBase64}` } },
        ],
      }),
    { system: params.system, prompt: params.prompt, image: { base64: params.imageBase64, mediaType: params.mediaType } }
  );
}
