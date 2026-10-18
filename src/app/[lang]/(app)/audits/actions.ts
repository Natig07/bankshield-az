"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { hasLocale } from "@/i18n/config";
import { requireEngagementPermission, requirePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  ApprovedAssessmentRequiredError,
  IndependentApproverRequiredError,
  addEngagementParticipant,
  assignEngagementAuditor,
  createEngagement,
  DuplicateEngagementRecordError,
  EngagementLockedError,
  EngagementRecordNotFoundError,
  engagementInputSchema,
  InvalidAuditorError,
  InvalidEngagementTransitionError,
  InvalidParticipantError,
  removeEngagementParticipant,
  selectEngagementRequirement,
  transitionEngagement,
  UnverifiedRequirementDecisionError,
  updateEngagement,
  updateEngagementSchema,
} from "@/lib/audits/service";
import { ENGAGEMENT_STATUSES } from "@/lib/audits/workflow";

export type EngagementActionState =
  | {
      error?: "invalidInput" | "invalidAuditor" | "notFound" | "duplicate" | "invalidTransition" | "unverifiedDecision" | "locked" | "invalidParticipant" | "approvedAssessmentRequired" | "independentApproverRequired";
      success?: "saved" | "statusUpdated" | "requirementSelected" | "auditorAssigned" | "participantAdded" | "participantRemoved";
      engagementId?: string;
    }
  | null;

const statusSchema = z.enum(ENGAGEMENT_STATUSES);
const localeSchema = z.string().refine(hasLocale);

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function locale(formData: FormData): string | null {
  const parsed = localeSchema.safeParse(formData.get("lang"));
  return parsed.success ? parsed.data : null;
}

function revalidateAuditPages(lang: string, engagementId?: string) {
  revalidatePath(`/${lang}/audits`);
  revalidatePath(`/${lang}`);
  if (engagementId) revalidatePath(`/${lang}/audits/${engagementId}`);
}

function knownError(error: unknown): NonNullable<EngagementActionState>["error"] | undefined {
  if (error instanceof ZodError) return "invalidInput";
  if (error instanceof InvalidAuditorError) return "invalidAuditor";
  if (error instanceof EngagementRecordNotFoundError) return "notFound";
  if (error instanceof DuplicateEngagementRecordError) return "duplicate";
  if (error instanceof InvalidEngagementTransitionError) return "invalidTransition";
  if (error instanceof UnverifiedRequirementDecisionError) return "unverifiedDecision";
  if (error instanceof EngagementLockedError) return "locked";
  if (error instanceof InvalidParticipantError) return "invalidParticipant";
  if (error instanceof ApprovedAssessmentRequiredError) return "approvedAssessmentRequired";
  if (error instanceof IndependentApproverRequiredError) return "independentApproverRequired";
  return undefined;
}

export async function createEngagementAction(
  _previousState: EngagementActionState,
  formData: FormData,
): Promise<EngagementActionState> {
  const actor = await requirePermission("audit:manage");
  const lang = locale(formData);
  if (!lang) return { error: "invalidInput" };
  const input = {
    title: formValue(formData, "title"),
    auditedOrganization: formValue(formData, "auditedOrganization"),
    scope: formValue(formData, "scope"),
    periodStart: formValue(formData, "periodStart"),
    periodEnd: formValue(formData, "periodEnd"),
    assignedAuditorId: formValue(formData, "assignedAuditorId"),
  };
  const parsed = engagementInputSchema.safeParse(input);
  if (!parsed.success) return { error: "invalidInput" };
  try {
    const created = await createEngagement(getPrisma(), actor, input);
    revalidateAuditPages(lang);
    return { success: "saved", engagementId: created.id };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function updateEngagementAction(
  _previousState: EngagementActionState,
  formData: FormData,
): Promise<EngagementActionState> {
  const engagementId = formValue(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "audit:manage");
  const lang = locale(formData);
  const input = {
    title: formValue(formData, "title"),
    auditedOrganization: formValue(formData, "auditedOrganization"),
    scope: formValue(formData, "scope"),
    periodStart: formValue(formData, "periodStart"),
    periodEnd: formValue(formData, "periodEnd"),
  };
  const parsed = updateEngagementSchema.safeParse(input);
  if (!lang || !parsed.success) return { error: "invalidInput" };
  try {
    await updateEngagement(getPrisma(), actor.id, engagementId, input);
    revalidateAuditPages(lang, engagementId);
    return { success: "saved" };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function transitionEngagementAction(
  _previousState: EngagementActionState,
  formData: FormData,
): Promise<EngagementActionState> {
  const engagementId = formValue(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "audit:manage");
  const lang = locale(formData);
  const targetStatus = statusSchema.safeParse(formData.get("targetStatus"));
  if (!lang || !targetStatus.success) return { error: "invalidInput" };
  try {
    await transitionEngagement(getPrisma(), actor.id, engagementId, targetStatus.data);
    revalidateAuditPages(lang, engagementId);
    return { success: "statusUpdated" };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function selectRequirementAction(
  _previousState: EngagementActionState,
  formData: FormData,
): Promise<EngagementActionState> {
  const engagementId = formValue(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "audit:manage");
  const lang = locale(formData);
  if (!lang) return { error: "invalidInput" };
  const acknowledged = formValue(formData, "acknowledgeUnverified") === "true";
  try {
    await selectEngagementRequirement(getPrisma(), actor.id, {
      engagementId,
      requirementId: formValue(formData, "requirementId"),
      acknowledgeUnverified: acknowledged,
      decisionNote: formValue(formData, "decisionNote"),
    });
    revalidateAuditPages(lang, engagementId);
    return { success: "requirementSelected" };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function assignAuditorAction(
  _previousState: EngagementActionState,
  formData: FormData,
): Promise<EngagementActionState> {
  const engagementId = formValue(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "audit:manage");
  if (actor.role !== "ADMINISTRATOR") return { error: "invalidInput" };
  const lang = locale(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await assignEngagementAuditor(getPrisma(), actor.id, {
      engagementId,
      auditorId: formValue(formData, "auditorId"),
    });
    revalidateAuditPages(lang, engagementId);
    return { success: "auditorAssigned" };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function addParticipantAction(
  _previousState: EngagementActionState,
  formData: FormData,
): Promise<EngagementActionState> {
  const engagementId = formValue(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "audit:manage");
  if (actor.role !== "ADMINISTRATOR") return { error: "invalidInput" };
  const lang = locale(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await addEngagementParticipant(getPrisma(), actor.id, { engagementId, userId: formValue(formData, "userId") });
    revalidateAuditPages(lang, engagementId);
    return { success: "participantAdded" };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function removeParticipantAction(
  _previousState: EngagementActionState,
  formData: FormData,
): Promise<EngagementActionState> {
  const engagementId = formValue(formData, "engagementId");
  const actor = await requireEngagementPermission(engagementId, "audit:manage");
  if (actor.role !== "ADMINISTRATOR") return { error: "invalidInput" };
  const lang = locale(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    await removeEngagementParticipant(getPrisma(), actor.id, { engagementId, userId: formValue(formData, "userId") });
    revalidateAuditPages(lang, engagementId);
    return { success: "participantRemoved" };
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}
