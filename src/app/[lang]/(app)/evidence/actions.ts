"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { hasLocale } from "@/i18n/config";
import { EngagementLockedError } from "@/lib/audits/service";
import { requirePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  DuplicateEvidenceError,
  EvidenceNotFoundError,
  EvidenceReviewStateError,
  IndependentEvidenceReviewError,
  InvalidEvidenceScopeError,
  reviewEvidence,
  uploadEvidence,
} from "@/lib/evidence/service";
import { EvidenceStorageError, openEvidenceStorage } from "@/lib/evidence/storage";
import { EvidenceValidationError, MAX_EVIDENCE_BYTES } from "@/lib/evidence/validation";

export type EvidenceActionState =
  | {
      error?:
        | "invalidInput"
        | "notFound"
        | "duplicate"
        | "invalidScope"
        | "locked"
        | "independentReview"
        | "reviewState"
        | "empty"
        | "tooLarge"
        | "unsupportedType"
        | "contentMismatch"
        | "activeContent"
        | "storageUnavailable";
      success?: "uploaded" | "reviewed";
    }
  | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function localeOf(formData: FormData): string | null {
  const value = text(formData, "lang");
  return hasLocale(value) ? value : null;
}

function knownError(error: unknown): NonNullable<EvidenceActionState>["error"] | undefined {
  if (error instanceof ZodError) return "invalidInput";
  if (error instanceof EvidenceValidationError) return error.reason;
  if (error instanceof EvidenceNotFoundError) return "notFound";
  if (error instanceof DuplicateEvidenceError) return "duplicate";
  if (error instanceof InvalidEvidenceScopeError) return "invalidScope";
  if (error instanceof EngagementLockedError) return "locked";
  if (error instanceof IndependentEvidenceReviewError) return "independentReview";
  if (error instanceof EvidenceReviewStateError) return "reviewState";
  if (error instanceof EvidenceStorageError) return "storageUnavailable";
  return undefined;
}

export async function uploadEvidenceAction(
  _previous: EvidenceActionState,
  formData: FormData,
): Promise<EvidenceActionState> {
  const actor = await requirePermission("evidence:manage");
  const lang = localeOf(formData);
  const file = formData.get("file");
  if (!lang || !(file instanceof File)) return { error: "invalidInput" };
  if (file.size === 0) return { error: "empty" };
  // Cheap early check; the service validates the real bytes again.
  if (file.size > MAX_EVIDENCE_BYTES) return { error: "tooLarge" };
  try {
    const storage = await openEvidenceStorage();
    await uploadEvidence(getPrisma(), storage, actor, {
      engagementId: text(formData, "engagementId"),
      controlId: text(formData, "controlId") || null,
      replacesId: text(formData, "replacesId") || null,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    revalidatePath(`/${lang}/evidence`);
    revalidatePath(`/${lang}/audits/${text(formData, "engagementId")}`);
    return { success: "uploaded" };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function reviewEvidenceAction(
  _previous: EvidenceActionState,
  formData: FormData,
): Promise<EvidenceActionState> {
  const actor = await requirePermission("evidence:review");
  const lang = localeOf(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await reviewEvidence(getPrisma(), actor, text(formData, "evidenceId"), {
      decision: text(formData, "decision"),
      note: text(formData, "note"),
    });
    revalidatePath(`/${lang}/evidence`);
    return { success: "reviewed" };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}
