import "server-only";
import { GoogleGenAI } from "@google/genai";

export type ModelRequest = {
  model: string;
  systemInstruction: string;
  userContent: string;
  jsonSchema: Record<string, unknown>;
  timeoutMs: number;
};

export type ModelFailureCode = "timeout" | "rateLimited" | "authentication" | "providerError" | "blocked";

export class ModelCallError extends Error {
  constructor(readonly code: ModelFailureCode) {
    super(`The model call failed (${code}).`);
    this.name = "ModelCallError";
  }
}

// Seam used by the service and replaced by a fake in automated tests.
export interface AiReviewModelClient {
  generate(request: ModelRequest): Promise<string>;
}

export function createGeminiClient(apiKey: string): AiReviewModelClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await ai.models.generateContent({
          model: request.model,
          contents: request.userContent,
          config: {
            systemInstruction: request.systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema: request.jsonSchema,
            temperature: 0.2,
            maxOutputTokens: 8_192,
            abortSignal: controller.signal,
            httpOptions: { timeout: request.timeoutMs },
          },
        });
        if (response.promptFeedback?.blockReason) throw new ModelCallError("blocked");
        const text = response.text;
        if (!text) throw new ModelCallError("providerError");
        return text;
      } catch (error) {
        if (error instanceof ModelCallError) throw error;
        const code = classify(error, controller.signal.aborted);
        // Diagnostics only: error class, HTTP status and Google's own error category/reason.
        // Never the request, the records sent or the key.
        console.error("Gemini request failed.", { code, ...describeProviderError(error, apiKey) });
        throw new ModelCallError(code);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const MAX_DETAIL = 300;

// Extracts a safe summary from an SDK error. The SDK stores Google's JSON error body in the
// message; only its category, reason codes and a short redacted message are kept.
export function describeProviderError(error: unknown, apiKey: string): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    errorName: error instanceof Error ? error.name : "UnknownError",
    status: typeof error === "object" && error !== null && "status" in error ? (error as { status: unknown }).status : undefined,
  };
  if (!(error instanceof Error)) return summary;
  try {
    const body = JSON.parse(error.message) as { error?: { status?: unknown; message?: unknown; details?: unknown } };
    const inner = body.error;
    if (typeof inner?.status === "string") summary.googleStatus = inner.status.slice(0, 40);
    if (Array.isArray(inner?.details)) {
      const reasons = inner.details
        .map((detail) => (detail && typeof detail === "object" && "reason" in detail ? String((detail as { reason: unknown }).reason) : ""))
        .filter(Boolean)
        .map((reason) => reason.slice(0, 60));
      if (reasons.length) summary.reasons = reasons.slice(0, 3);
    }
    if (typeof inner?.message === "string") {
      let message = inner.message.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
      if (apiKey.length >= 8) message = message.split(apiKey).join("[redacted]");
      summary.googleMessage = message.replace(/\s+/g, " ").slice(0, MAX_DETAIL);
    }
  } catch {
    // Not JSON (for example a network error): the error name above is all we keep.
  }
  return summary;
}

function classify(error: unknown, aborted: boolean): ModelFailureCode {
  if (aborted) return "timeout";
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : NaN;
  if (status === 429) return "rateLimited";
  if (status === 401 || status === 403) return "authentication";
  if (status === 408 || status === 504) return "timeout";
  return "providerError";
}
