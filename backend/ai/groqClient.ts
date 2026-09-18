import { AiNotConfiguredError, AiRequestError } from "./types.js";

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
    throw new AiRequestError(message || `Groq returned ${response.status}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new AiRequestError("Groq returned no content.");
  return text;
}

export function callGroqText(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<string> {
  return callChat({
    model: getTextModel(),
    system: params.system,
    userContent: params.prompt,
    maxTokens: params.maxTokens,
    reasoningEffort: params.reasoningEffort,
  });
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
  return callChat({
    model: params.model,
    system: params.system,
    maxTokens: params.maxTokens,
    reasoningEffort: params.reasoningEffort,
    userContent: [
      { type: "text", text: params.prompt },
      { type: "image_url", image_url: { url: `data:${params.mediaType};base64,${params.imageBase64}` } },
    ],
  });
}
