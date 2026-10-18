import "server-only";
import { readGeminiConfig } from "./config";
import { createGeminiClient } from "./gemini";
import type { AiReviewDeps } from "./service";

// Builds the production dependencies from server environment variables on each call,
// so a key added to .env takes effect after a restart without code changes.
export function getAiReviewDeps(): AiReviewDeps {
  const config = readGeminiConfig();
  return { config, client: config.ok ? createGeminiClient(config.config.apiKey) : null };
}
