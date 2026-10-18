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
        throw new ModelCallError(classify(error, controller.signal.aborted));
      } finally {
        clearTimeout(timer);
      }
    },
  };
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
