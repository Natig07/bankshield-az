"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { hasLocale } from "@/i18n/config";
import { requireEngagementPermission, requirePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  approveAssessment,
  ConcurrentAssessmentRevisionError,
  ControlRecordNotFoundError,
  createAssessmentRevision,
  createControl,
  createRequirementControlMapping,
  DuplicateControlRecordError,
  DuplicateRequirementMappingError,
  InvalidAssessmentApprovalError,
  InvalidAssessmentEvidenceError,
  InvalidAssessmentTransitionError,
  updateControl,
} from "@/lib/controls/service";

export type ControlActionState =
  | {
      error?: "invalidInput" | "duplicateControl" | "duplicateMapping" | "notFound" | "invalidEvidence" | "approvalRejected" | "invalidTransition" | "concurrentRevision";
      success?: "saved" | "mapped" | "assessmentSaved" | "approved";
    }
  | null;

function value(formData: FormData, key: string): string {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry : "";
}

function langValue(formData: FormData): string | null {
  const entry = formData.get("lang");
  return typeof entry === "string" && hasLocale(entry) ? entry : null;
}

function errorCode(error: unknown): NonNullable<ControlActionState>["error"] | undefined {
  if (error instanceof ZodError) return "invalidInput";
  if (error instanceof DuplicateControlRecordError) return "duplicateControl";
  if (error instanceof DuplicateRequirementMappingError) return "duplicateMapping";
  if (error instanceof ControlRecordNotFoundError) return "notFound";
  if (error instanceof InvalidAssessmentEvidenceError) return "invalidEvidence";
  if (error instanceof InvalidAssessmentApprovalError) return "approvalRejected";
  if (error instanceof InvalidAssessmentTransitionError) return "invalidTransition";
  if (error instanceof ConcurrentAssessmentRevisionError) return "concurrentRevision";
  return undefined;
}

function revalidateControlPages(lang: string, engagementId?: string) {
  revalidatePath(`/${lang}/controls`);
  if (engagementId) revalidatePath(`/${lang}/audits/${engagementId}`);
}

function controlInput(formData: FormData) {
  return {
    code: value(formData, "code"),
    title: value(formData, "title"),
    description: value(formData, "description") || null,
    domain: value(formData, "domain") || null,
    source: value(formData, "source"),
  };
}

export async function createControlAction(
  _previousState: ControlActionState,
  formData: FormData,
): Promise<ControlActionState> {
  const actor = await requirePermission("controls:manage");
  const lang = langValue(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await createControl(getPrisma(), actor, controlInput(formData));
    revalidateControlPages(lang);
    return { success: "saved" };
  } catch (error) {
    const code = errorCode(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function updateControlAction(
  _previousState: ControlActionState,
  formData: FormData,
): Promise<ControlActionState> {
  const actor = await requirePermission("controls:manage");
  const lang = langValue(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await updateControl(getPrisma(), actor, value(formData, "controlId"), controlInput(formData));
    revalidateControlPages(lang);
    return { success: "saved" };
  } catch (error) {
    const code = errorCode(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function createMappingAction(
  _previousState: ControlActionState,
  formData: FormData,
): Promise<ControlActionState> {
  const actor = await requirePermission("controls:manage");
  const lang = langValue(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await createRequirementControlMapping(getPrisma(), actor, {
      controlId: value(formData, "controlId"),
      requirementId: value(formData, "requirementId"),
      rationale: value(formData, "rationale"),
    });
    revalidateControlPages(lang);
    return { success: "mapped" };
  } catch (error) {
    const code = errorCode(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function createAssessmentRevisionAction(
  _previousState: ControlActionState,
  formData: FormData,
): Promise<ControlActionState> {
  const engagementId = value(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "controls:assess");
  const lang = langValue(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await createAssessmentRevision(getPrisma(), actor, engagementId, value(formData, "scopeItemId"), {
      status: value(formData, "status"),
      notApplicableReason: value(formData, "notApplicableReason") || null,
      evidenceIds: formData.getAll("evidenceIds").filter((entry): entry is string => typeof entry === "string"),
    });
    revalidateControlPages(lang, engagementId);
    return { success: "assessmentSaved" };
  } catch (error) {
    const code = errorCode(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function approveAssessmentAction(
  _previousState: ControlActionState,
  formData: FormData,
): Promise<ControlActionState> {
  const engagementId = value(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "controls:assess");
  const lang = langValue(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await approveAssessment(getPrisma(), actor, engagementId, value(formData, "assessmentId"), {
      justification: value(formData, "justification"),
    });
    revalidateControlPages(lang, engagementId);
    return { success: "approved" };
  } catch (error) {
    const code = errorCode(error);
    if (code) return { error: code };
    throw error;
  }
}
