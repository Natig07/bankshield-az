import "server-only";

export const AI_REVIEW_PROMPT_VERSION = "ai-review-v1";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 180_000;

export type GeminiConfig = { apiKey: string; model: string; timeoutMs: number };

export type GeminiConfigResult =
  | { ok: true; config: GeminiConfig }
  | { ok: false; reason: "missingKey" | "invalidModel" };

// The key is read only on the server and is never returned to the client or logged.
export function readGeminiConfig(env: Record<string, string | undefined> = process.env): GeminiConfigResult {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "missingKey" };
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(model)) return { ok: false, reason: "invalidModel" };
  const requested = Number(env.GEMINI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(requested) && requested > 0
    ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(requested)))
    : DEFAULT_TIMEOUT_MS;
  return { ok: true, config: { apiKey, model, timeoutMs } };
}
