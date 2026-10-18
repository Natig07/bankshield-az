import { z } from "zod";

export const SUGGESTION_KINDS = ["POTENTIAL_GAP", "INSUFFICIENT_BASIS"] as const;
export const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const TARGET_TYPES = ["SCOPE_ITEM", "FINDING", "RISK"] as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const modelSuggestionSchema = z.object({
  targetRef: z.string().trim().regex(/^[SFR][0-9]{1,3}$/),
  kind: z.enum(SUGGESTION_KINDS),
  title: text(3, 200),
  reasoning: text(10, 2_000),
  recommendedActions: z.array(text(3, 500)).min(1).max(6),
  verificationSteps: z.array(text(3, 500)).min(1).max(6),
  confidence: z.enum(CONFIDENCE_LEVELS),
  limitations: text(3, 1_000),
});

export const MAX_SUGGESTIONS = 20;

export const modelOutputSchema = z.object({
  suggestions: z.array(modelSuggestionSchema).max(MAX_SUGGESTIONS),
});

export type ModelSuggestion = z.infer<typeof modelSuggestionSchema>;

// JSON Schema handed to Gemini as a structured-output constraint. The server still
// re-validates everything with Zod; the constraint only improves the odds of valid output.
export function modelOutputJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(modelOutputSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
