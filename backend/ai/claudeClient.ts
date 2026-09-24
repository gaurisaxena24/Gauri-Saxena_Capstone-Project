/**
 * Backup AI provider. Groq (backend/ai/groqClient.ts) stays the primary; when a Groq call fails —
 * most often its free-tier daily token limit, but also an outage or a bad response — the same
 * request (same system prompt, same text or image) is sent here instead, so reminders, thank-you
 * messages, receipt reading and the Gmail AI fallback keep working. Only active when
 * ANTHROPIC_API_KEY is set; without it every caller behaves exactly as before.
 *
 * Returns the model's raw text, same as the Groq path — every caller already parses it with
 * extractJson, and every system prompt already demands JSON-only output.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AiRequestError } from "./types.js";

const CLAUDE_MODEL = "claude-opus-5";

/** Output here is always a short JSON object; low effort keeps it fast and cheap. The ceiling is
 * generous (not the Groq callers' tight per-call limits) because adaptive thinking also spends
 * from max_tokens, and a truncated reply is worse than a few unused tokens. */
const MAX_TOKENS = 16000;

let client: Anthropic | undefined;

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

type ClaudeMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function toClaudeMediaType(mediaType: string): ClaudeMediaType {
  const normalized = mediaType.toLowerCase() === "image/jpg" ? "image/jpeg" : mediaType.toLowerCase();
  if (normalized === "image/png" || normalized === "image/gif" || normalized === "image/webp") return normalized;
  return "image/jpeg";
}

export async function callClaude(params: {
  system: string;
  prompt: string;
  image?: { base64: string; mediaType: string };
}): Promise<string> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (params.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: toClaudeMediaType(params.image.mediaType), data: params.image.base64 },
    });
  }
  content.push({ type: "text", text: params.prompt });

  let response: Anthropic.Beta.BetaMessage;
  try {
    // Server-side refusal fallback: if the model declines (e.g. an "Unhinged" reminder trips a safety
    // classifier), the API retries on a fallback model inside this same call.
    response = await getClient().beta.messages.create({
      model: CLAUDE_MODEL,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: MAX_TOKENS,
      output_config: { effort: "low" },
      system: `${params.system}\n\nRespond with ONLY the JSON object — no markdown fences, no prose before or after it.`,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AiRequestError("Claude backup: ANTHROPIC_API_KEY was rejected.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiRequestError("Claude backup is rate-limited too — try again in a minute.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AiRequestError(`Claude backup failed (${error.status ?? "network"}): ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new AiRequestError("Claude backup declined this request.");
  }
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text) throw new AiRequestError("Claude backup returned no content.");
  return text;
}
