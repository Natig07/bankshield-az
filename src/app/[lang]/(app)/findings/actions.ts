"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { hasLocale } from "@/i18n/config";
import { EngagementLockedError, EngagementRecordNotFoundError } from "@/lib/audits/service";
import { requirePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  addRemediationAction,
  createFinding,
  FindingLockedError,
  FindingNotFoundError,
  FindingRuleError,
  InvalidFindingTransitionError,
  StaleFindingError,
  transitionFinding,
  updateFinding,
  updateRemediationStatus,
} from "@/lib/findings/service";

export type FindingActionState =
  | {
      error?:
        | "invalidInput"
        | "notFound"
        | "stale"
        | "locked"
        | "engagementLocked"
        | "invalidTransition"
        | "needsAction"
        | "actionsIncomplete"
        | "actionsUnverified"
        | "needsNote"
        | "independentClosure"
        | "ownerCannotVerify"
        | "invalidEvidence";
      success?: "created" | "saved" | "statusChanged" | "actionAdded" | "actionUpdated";
      findingId?: string;
    }
  | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
const nullable = (formData: FormData, key: string) => text(formData, key) || null;
function integer(formData: FormData, key: string): number {
  const value = text(formData, key);
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}
function nullableInteger(formData: FormData, key: string): number | null {
  return text(formData, key) === "" ? null : integer(formData, key);
}

function knownError(error: unknown): NonNullable<FindingActionState>["error"] | undefined {
  if (error instanceof ZodError) return "invalidInput";
  if (error instanceof FindingNotFoundError || error instanceof EngagementRecordNotFoundError) return "notFound";
  if (error instanceof StaleFindingError) return "stale";
  if (error instanceof FindingLockedError) return "locked";
  if (error instanceof EngagementLockedError) return "engagementLocked";
  if (error instanceof InvalidFindingTransitionError) return "invalidTransition";
  if (error instanceof FindingRuleError) return error.rule;
  return undefined;
}

function fields(formData: FormData) {
  return {
    title: text(formData, "title"),
    description: text(formData, "description"),
    severity: text(formData, "severity"),
    requirementId: nullable(formData, "requirementId"),
    inherentLikelihood: nullableInteger(formData, "inherentLikelihood"),
    inherentImpact: nullableInteger(formData, "inherentImpact"),
    residualLikelihood: nullableInteger(formData, "residualLikelihood"),
    residualImpact: nullableInteger(formData, "residualImpact"),
  };
}

async function run(
  formData: FormData,
  permission: "findings:manage" | "findings:remediate",
  work: (actor: Awaited<ReturnType<typeof requirePermission>>) => Promise<NonNullable<FindingActionState>>,
): Promise<FindingActionState> {
  const actor = await requirePermission(permission);
  const lang = text(formData, "lang");
  if (!hasLocale(lang)) return { error: "invalidInput" };
  try {
    const result = await work(actor);
    revalidatePath(`/${lang}/findings`);
    revalidatePath(`/${lang}`);
    revalidatePath(`/${lang}/audits`, "layout");
    if (result.findingId) revalidatePath(`/${lang}/findings/${result.findingId}`);
    return result;
  } catch (error) {
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function createFindingAction(_previous: FindingActionState, formData: FormData): Promise<FindingActionState> {
  return run(formData, "findings:manage", async (actor) => {
    const created = await createFinding(getPrisma(), actor, { engagementId: text(formData, "engagementId"), ...fields(formData) });
    return { success: "created", findingId: created.id };
  });
}

export async function updateFindingAction(_previous: FindingActionState, formData: FormData): Promise<FindingActionState> {
  return run(formData, "findings:manage", async (actor) => {
    const findingId = text(formData, "findingId");
    await updateFinding(getPrisma(), actor, findingId, { ...fields(formData), expectedUpdatedAt: integer(formData, "expectedUpdatedAt") });
    return { success: "saved", findingId };
  });
}

export async function transitionFindingAction(_previous: FindingActionState, formData: FormData): Promise<FindingActionState> {
  return run(formData, "findings:manage", async (actor) => {
    const findingId = text(formData, "findingId");
    await transitionFinding(getPrisma(), actor, findingId, {
      targetStatus: text(formData, "targetStatus"),
      expectedUpdatedAt: integer(formData, "expectedUpdatedAt"),
      note: text(formData, "note"),
    });
    return { success: "statusChanged", findingId };
  });
}

export async function addRemediationActionAction(_previous: FindingActionState, formData: FormData): Promise<FindingActionState> {
  return run(formData, "findings:manage", async (actor) => {
    const findingId = text(formData, "findingId");
    await addRemediationAction(getPrisma(), actor, {
      findingId,
      ownerName: text(formData, "ownerName"),
      actionPlan: text(formData, "actionPlan"),
      dueDate: text(formData, "dueDate"),
    });
    return { success: "actionAdded", findingId };
  });
}

// Doing the work needs findings:remediate; verifying needs findings:manage (checked in the service).
export async function updateRemediationStatusAction(_previous: FindingActionState, formData: FormData): Promise<FindingActionState> {
  const target = text(formData, "targetStatus");
  return run(formData, target === "VERIFIED" ? "findings:manage" : "findings:remediate", async (actor) => {
    await updateRemediationStatus(getPrisma(), actor, {
      actionId: text(formData, "actionId"),
      targetStatus: target,
      completionEvidenceId: nullable(formData, "completionEvidenceId"),
    });
    return { success: "actionUpdated", findingId: text(formData, "findingId") };
  });
}
