"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { hasLocale } from "@/i18n/config";
import { ForbiddenError, requireEngagementPermission, requirePermission } from "@/lib/auth/dal";
import { canAccessEngagement } from "@/lib/auth/resource-access";
import { PermissionDeniedError } from "@/lib/auth/authorization";
import { getPrisma } from "@/lib/db";
import { getAiReviewDeps } from "@/lib/ai-review/runtime";
import {
  AiReviewEngagementNotFoundError,
  AiReviewFailedError,
  AiReviewNotConfiguredError,
  AiReviewNothingToAnalyseError,
  AiReviewRateLimitedError,
  AiSuggestionAlreadyReviewedError,
  AiSuggestionNotFoundError,
  reviewAiSuggestion,
  runAiReview,
} from "@/lib/ai-review/service";

export type AiReviewActionState =
  | {
      error?:
        | "invalidInput"
        | "consentRequired"
        | "notConfigured"
        | "notFound"
        | "nothingToAnalyse"
        | "rateLimited"
        | "timeout"
        | "providerRateLimited"
        | "authentication"
        | "providerError"
        | "blocked"
        | "invalidOutput"
        | "alreadyReviewed"
        | "noteRequired"
        | "forbidden";
      success?: "generated" | "accepted" | "rejected";
      count?: number;
    }
  | null;

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : "";
}

function language(formData: FormData): "az" | "en" | null {
  const lang = value(formData, "lang");
  return hasLocale(lang) && (lang === "az" || lang === "en") ? lang : null;
}

function mapError(error: unknown): NonNullable<AiReviewActionState>["error"] | undefined {
  if (error instanceof AiReviewNotConfiguredError) return "notConfigured";
  if (error instanceof AiReviewEngagementNotFoundError || error instanceof AiSuggestionNotFoundError) return "notFound";
  if (error instanceof AiReviewNothingToAnalyseError) return "nothingToAnalyse";
  if (error instanceof AiReviewRateLimitedError) return "rateLimited";
  if (error instanceof AiSuggestionAlreadyReviewedError) return "alreadyReviewed";
  if (error instanceof PermissionDeniedError) return "forbidden";
  if (error instanceof AiReviewFailedError) return error.code === "rateLimited" ? "providerRateLimited" : error.code;
  if (error instanceof ZodError) return error.issues.some((issue) => issue.path[0] === "note") ? "noteRequired" : "invalidInput";
  return undefined;
}

export async function runAiReviewAction(_previous: AiReviewActionState, formData: FormData): Promise<AiReviewActionState> {
  const engagementId = value(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "audit:manage");
  const lang = language(formData);
  if (!lang || !engagementId) return { error: "invalidInput" };
  // Explicit acknowledgement that selected records are processed by Google's Gemini API.
  if (value(formData, "consent") !== "on") return { error: "consentRequired" };
  try {
    const result = await runAiReview(getPrisma(), getAiReviewDeps(), actor, { engagementId, language: lang });
    revalidatePath(`/${lang}/ai-review`);
    return { success: "generated", count: result.suggestionCount };
  } catch (error) {
    const code = mapError(error);
    if (code) {
      revalidatePath(`/${lang}/ai-review`);
      return { error: code };
    }
    throw error;
  }
}

export async function reviewSuggestionAction(_previous: AiReviewActionState, formData: FormData): Promise<AiReviewActionState> {
  const actor = await requirePermission("audit:manage");
  const lang = language(formData);
  const suggestionId = value(formData, "suggestionId");
  if (!lang || !suggestionId) return { error: "invalidInput" };
  const db = getPrisma();
  // Unknown ids and engagements the user cannot access are indistinguishable.
  const suggestion = await db.aiReviewSuggestion.findUnique({ where: { id: suggestionId }, select: { engagementId: true } });
  if (!suggestion || !(await canAccessEngagement(db, actor, suggestion.engagementId))) return { error: "notFound" };
  const decision = value(formData, "decision");
  try {
    await reviewAiSuggestion(db, actor, { suggestionId, decision, note: value(formData, "note") });
    revalidatePath(`/${lang}/ai-review`);
    return { success: decision === "ACCEPTED" ? "accepted" : "rejected" };
  } catch (error) {
    const code = mapError(error);
    if (code) {
      revalidatePath(`/${lang}/ai-review`);
      return { error: code };
    }
    if (error instanceof ForbiddenError) return { error: "forbidden" };
    throw error;
  }
}
