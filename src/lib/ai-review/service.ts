import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertRolePermission, type Permission, type Role } from "@/lib/auth/authorization";
import { AI_REVIEW_PROMPT_VERSION, type GeminiConfigResult } from "./config";
import { ModelCallError, type AiReviewModelClient, type ModelFailureCode } from "./gemini";
import { collectReviewInput, type RefTarget } from "./input";
import { modelOutputJsonSchema, modelOutputSchema, type ModelSuggestion } from "./output-schema";
import { buildSystemInstruction, buildUserContent, type ReviewLanguage } from "./prompt";

type Actor = { id: string; role: Role };

export class AiReviewNotConfiguredError extends Error {
  constructor(readonly reason: "missingKey" | "invalidModel") {
    super("Gemini is not configured.");
    this.name = "AiReviewNotConfiguredError";
  }
}
export class AiReviewEngagementNotFoundError extends Error {
  constructor() {
    super("The engagement no longer exists.");
    this.name = "AiReviewEngagementNotFoundError";
  }
}
export class AiReviewNothingToAnalyseError extends Error {
  constructor() {
    super("The engagement has no scope items or findings to analyse.");
    this.name = "AiReviewNothingToAnalyseError";
  }
}
export class AiReviewRateLimitedError extends Error {
  constructor() {
    super("An analysis for this engagement was started moments ago.");
    this.name = "AiReviewRateLimitedError";
  }
}
export type AiReviewFailureCode = ModelFailureCode | "invalidOutput";
export class AiReviewFailedError extends Error {
  constructor(readonly code: AiReviewFailureCode) {
    super(`The AI analysis failed (${code}).`);
    this.name = "AiReviewFailedError";
  }
}
export class AiSuggestionNotFoundError extends Error {
  constructor() {
    super("The suggestion no longer exists.");
    this.name = "AiSuggestionNotFoundError";
  }
}
export class AiSuggestionAlreadyReviewedError extends Error {
  constructor() {
    super("The suggestion has already been reviewed.");
    this.name = "AiSuggestionAlreadyReviewedError";
  }
}

// Data leaves the system toward Google, so the caller must also be allowed to read every source.
const REQUIRED_PERMISSIONS: Permission[] = [
  "audit:manage",
  "regulatory:read",
  "controls:read",
  "findings:read",
  "risks:read",
];

export type AiReviewDeps = {
  config: GeminiConfigResult;
  client: AiReviewModelClient | null;
  cooldownMs?: number;
};

export type ParsedOutput = { suggestions: Array<ModelSuggestion & { target: RefTarget }>; discarded: number };

// Parses and validates the raw model text. Suggestions pointing at refs that were not sent are
// discarded; if nothing usable remains from a non-empty answer the whole output is rejected.
export function parseModelOutput(raw: string, refs: Map<string, RefTarget>): ParsedOutput {
  if (raw.length > 200_000) throw new AiReviewFailedError("invalidOutput");
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(unfenced);
  } catch {
    throw new AiReviewFailedError("invalidOutput");
  }
  const parsed = modelOutputSchema.safeParse(json);
  if (!parsed.success) throw new AiReviewFailedError("invalidOutput");
  const usable: ParsedOutput["suggestions"] = [];
  let discarded = 0;
  for (const suggestion of parsed.data.suggestions) {
    const target = refs.get(suggestion.targetRef);
    if (!target) {
      discarded += 1;
      continue;
    }
    usable.push({ ...suggestion, target });
  }
  if (parsed.data.suggestions.length > 0 && usable.length === 0) throw new AiReviewFailedError("invalidOutput");
  return { suggestions: usable, discarded };
}

function failureEvent(actorId: string, engagementId: string, detail: string) {
  return {
    actorId,
    action: "AI_REVIEW_RUN",
    entityType: "AuditEngagement",
    entityId: engagementId,
    outcome: "FAILURE",
    detail,
  };
}

export async function runAiReview(
  db: PrismaClient,
  deps: AiReviewDeps,
  actor: Actor,
  input: { engagementId: string; language: ReviewLanguage },
) {
  for (const permission of REQUIRED_PERMISSIONS) assertRolePermission(actor.role, permission);
  if (!deps.config.ok || !deps.client) {
    const reason = deps.config.ok ? "missingKey" : deps.config.reason;
    await db.auditEvent.create({ data: failureEvent(actor.id, input.engagementId, `notConfigured:${reason}`) }).catch(() => undefined);
    throw new AiReviewNotConfiguredError(reason);
  }
  const { config } = deps.config;

  const collected = await collectReviewInput(db, input.engagementId);
  if (!collected) throw new AiReviewEngagementNotFoundError();
  if (collected.summary.scopeItems === 0 && collected.summary.findings === 0) throw new AiReviewNothingToAnalyseError();

  const cooldownMs = deps.cooldownMs ?? 15_000;
  if (cooldownMs > 0) {
    const recent = await db.aiReviewRun.findFirst({
      where: { engagementId: input.engagementId, createdAt: { gt: new Date(Date.now() - cooldownMs) } },
      select: { id: true },
    });
    if (recent) throw new AiReviewRateLimitedError();
  }

  const startedAt = Date.now();
  const base = {
    engagementId: input.engagementId,
    requestedById: actor.id,
    provider: "gemini",
    model: config.model,
    promptVersion: AI_REVIEW_PROMPT_VERSION,
  };
  const failRun = async (code: AiReviewFailureCode) => {
    await db.$transaction([
      db.aiReviewRun.create({
        data: { ...base, status: "FAILED", errorCode: code, inputSummary: JSON.stringify(collected.summary), durationMs: Date.now() - startedAt },
      }),
      db.auditEvent.create({ data: failureEvent(actor.id, input.engagementId, code) }),
    ]);
    throw new AiReviewFailedError(code);
  };

  let raw: string;
  try {
    raw = await deps.client.generate({
      model: config.model,
      systemInstruction: buildSystemInstruction(input.language),
      userContent: buildUserContent(collected.payload),
      jsonSchema: modelOutputJsonSchema(),
      timeoutMs: config.timeoutMs,
    });
  } catch (error) {
    return failRun(error instanceof ModelCallError ? error.code : "providerError");
  }

  let parsed: ParsedOutput;
  try {
    parsed = parseModelOutput(raw, collected.refs);
  } catch (error) {
    return failRun(error instanceof AiReviewFailedError ? error.code : "invalidOutput");
  }

  return db.$transaction(async (tx) => {
    const run = await tx.aiReviewRun.create({
      data: {
        ...base,
        status: "SUCCEEDED",
        inputSummary: JSON.stringify({ ...collected.summary, discardedSuggestions: parsed.discarded }),
        suggestionCount: parsed.suggestions.length,
        durationMs: Date.now() - startedAt,
      },
    });
    for (const suggestion of parsed.suggestions) {
      await tx.aiReviewSuggestion.create({
        data: {
          runId: run.id,
          engagementId: input.engagementId,
          targetType: suggestion.target.type,
          targetId: suggestion.target.id,
          requirementId: suggestion.target.requirementId,
          kind: suggestion.kind,
          title: suggestion.title,
          reasoning: suggestion.reasoning,
          recommendedActions: JSON.stringify(suggestion.recommendedActions),
          verificationSteps: JSON.stringify(suggestion.verificationSteps),
          confidence: suggestion.confidence,
          limitations: suggestion.limitations,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "AI_REVIEW_RUN",
        entityType: "AuditEngagement",
        entityId: input.engagementId,
        outcome: "SUCCESS",
        detail: `${parsed.suggestions.length} pending suggestions`,
      },
    });
    return { runId: run.id, suggestionCount: parsed.suggestions.length };
  });
}

const reviewSchema = z.object({
  suggestionId: z.string().min(1),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  note: z.string().trim().max(1_000),
});

// Accepting records a human judgement only. No finding, risk, assessment or status is changed.
export async function reviewAiSuggestion(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "audit:manage");
  const data = reviewSchema.parse(input);
  if (data.decision === "REJECTED" && data.note.length < 3) throw new z.ZodError([{ code: "custom", path: ["note"], message: "A rejection needs a short reason." }]);
  return db.$transaction(async (tx) => {
    const existing = await tx.aiReviewSuggestion.findUnique({ where: { id: data.suggestionId }, select: { id: true, engagementId: true } });
    if (!existing) throw new AiSuggestionNotFoundError();
    // Compare-and-set so two reviewers cannot both decide the same suggestion.
    const changed = await tx.aiReviewSuggestion.updateMany({
      where: { id: data.suggestionId, reviewStatus: "PENDING_REVIEW" },
      data: { reviewStatus: data.decision, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: data.note || null },
    });
    if (changed.count !== 1) throw new AiSuggestionAlreadyReviewedError();
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: data.decision === "ACCEPTED" ? "AI_SUGGESTION_ACCEPTED" : "AI_SUGGESTION_REJECTED",
        entityType: "AiReviewSuggestion",
        entityId: data.suggestionId,
        outcome: "SUCCESS",
        detail: `engagement ${existing.engagementId}`,
      },
    });
    return { engagementId: existing.engagementId };
  });
}
