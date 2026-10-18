"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { fieldIssues, type FieldIssue } from "@/lib/risks/field-errors";
import { hasLocale } from "@/i18n/config";
import { requirePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  createAsset,
  createRisk,
  createTreatmentAction,
  DuplicateRiskRecordError,
  InvalidRiskAssetError,
  InvalidRiskTransitionError,
  linkRiskControl,
  RiskLockedError,
  RiskNotFoundError,
  RiskTransitionRuleError,
  StaleRiskError,
  transitionRisk,
  unlinkRiskControl,
  updateRisk,
  updateTreatmentActionStatus,
} from "@/lib/risks/service";

export type RiskActionState =
  | {
      error?:
        | "invalidInput"
        | "notFound"
        | "duplicate"
        | "stale"
        | "locked"
        | "invalidTransition"
        | "invalidAsset"
        | "needsTreatment"
        | "needsAction"
        | "needsJustification"
        | "needsResidual"
        | "needsReviewDate"
        | "openActions"
        | "needsNote";
      success?: "created" | "saved" | "statusChanged" | "actionAdded" | "actionUpdated" | "linked" | "unlinked" | "assetCreated";
      riskId?: string;
      // Present for create/update risk: which fields failed validation and why.
      fields?: FieldIssue[];
    }
  | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullable(formData: FormData, key: string): string | null {
  return text(formData, key) || null;
}

function integer(formData: FormData, key: string): number {
  const value = text(formData, key);
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

function nullableInteger(formData: FormData, key: string): number | null {
  return text(formData, key) === "" ? null : integer(formData, key);
}

function localeOf(formData: FormData): string | null {
  const value = text(formData, "lang");
  return hasLocale(value) ? value : null;
}

function knownError(error: unknown): NonNullable<RiskActionState>["error"] | undefined {
  if (error instanceof ZodError) return "invalidInput";
  if (error instanceof RiskNotFoundError) return "notFound";
  if (error instanceof DuplicateRiskRecordError) return "duplicate";
  if (error instanceof StaleRiskError) return "stale";
  if (error instanceof RiskLockedError) return "locked";
  if (error instanceof InvalidRiskTransitionError) return "invalidTransition";
  if (error instanceof InvalidRiskAssetError) return "invalidAsset";
  if (error instanceof RiskTransitionRuleError) return error.rule;
  return undefined;
}

function riskFields(formData: FormData) {
  return {
    title: text(formData, "title"),
    description: text(formData, "description"),
    category: text(formData, "category"),
    assetId: nullable(formData, "assetId"),
    ownerName: text(formData, "ownerName"),
    inherentLikelihood: integer(formData, "inherentLikelihood"),
    inherentImpact: integer(formData, "inherentImpact"),
    residualLikelihood: nullableInteger(formData, "residualLikelihood"),
    residualImpact: nullableInteger(formData, "residualImpact"),
    treatment: nullable(formData, "treatment"),
    reviewDate: nullable(formData, "reviewDate"),
  };
}

async function run(
  formData: FormData,
  permission: "risks:manage",
  work: (actor: Awaited<ReturnType<typeof requirePermission>>, lang: string) => Promise<NonNullable<RiskActionState>>,
  options: { fieldErrors?: boolean } = {},
): Promise<RiskActionState> {
  const actor = await requirePermission(permission);
  const lang = localeOf(formData);
  if (!lang) return { error: "invalidInput" };
  try {
    const result = await work(actor, lang);
    revalidatePath(`/${lang}/risks`);
    revalidatePath(`/${lang}`);
    if (result.riskId) revalidatePath(`/${lang}/risks/${result.riskId}`);
    return result;
  } catch (error) {
    if (options.fieldErrors && error instanceof ZodError) return { error: "invalidInput", fields: fieldIssues(error) };
    const code = knownError(error);
    if (code) return { error: code };
    throw error;
  }
}

export async function createRiskAction(_previous: RiskActionState, formData: FormData): Promise<RiskActionState> {
  return run(formData, "risks:manage", async (actor) => {
    const created = await createRisk(getPrisma(), actor, riskFields(formData));
    return { success: "created", riskId: created.id };
  }, { fieldErrors: true });
}

export async function updateRiskAction(_previous: RiskActionState, formData: FormData): Promise<RiskActionState> {
  return run(formData, "risks:manage", async (actor) => {
    const riskId = text(formData, "riskId");
    await updateRisk(getPrisma(), actor, riskId, { ...riskFields(formData), expectedRevision: integer(formData, "expectedRevision") });
    return { success: "saved", riskId };
  }, { fieldErrors: true });
}

export async function transitionRiskAction(_previous: RiskActionState, formData: FormData): Promise<RiskActionState> {
  return run(formData, "risks:manage", async (actor) => {
    const riskId = text(formData, "riskId");
    await transitionRisk(getPrisma(), actor, riskId, {
      targetStatus: text(formData, "targetStatus"),
      expectedRevision: integer(formData, "expectedRevision"),
      note: text(formData, "note"),
      acceptanceJustification: text(formData, "acceptanceJustification") || undefined,
    });
    return { success: "statusChanged", riskId };
  });
}

export async function createAssetAction(_previous: RiskActionState, formData: FormData): Promise<RiskActionState> {
  return run(formData, "risks:manage", async (actor) => {
    await createAsset(getPrisma(), actor, {
      code: text(formData, "code"),
      name: text(formData, "name"),
      assetType: text(formData, "assetType"),
      criticality: text(formData, "criticality"),
      ownerName: text(formData, "ownerName"),
      description: nullable(formData, "description"),
    });
    return { success: "assetCreated" };
  });
}

export async function addTreatmentActionAction(_previous: RiskActionState, formData: FormData): Promise<RiskActionState> {
  return run(formData, "risks:manage", async (actor) => {
    const riskId = text(formData, "riskId");
    await createTreatmentAction(getPrisma(), actor, {
      riskId,
      title: text(formData, "title"),
      description: nullable(formData, "description"),
      ownerName: text(formData, "ownerName"),
      dueDate: text(formData, "dueDate"),
    });
    return { success: "actionAdded", riskId };
  });
}

export async function updateTreatmentActionAction(_previous: RiskActionState, formData: FormData): Promise<RiskActionState> {
  return run(formData, "risks:manage", async (actor) => {
    await updateTreatmentActionStatus(getPrisma(), actor, {
      actionId: text(formData, "actionId"),
      targetStatus: text(formData, "targetStatus"),
    });
    return { success: "actionUpdated", riskId: text(formData, "riskId") };
  });
}

export async function linkControlAction(_previous: RiskActionState, formData: FormData): Promise<RiskActionState> {
  return run(formData, "risks:manage", async (actor) => {
    const riskId = text(formData, "riskId");
    await linkRiskControl(getPrisma(), actor, { riskId, controlId: text(formData, "controlId") });
    return { success: "linked", riskId };
  });
}

export async function unlinkControlAction(_previous: RiskActionState, formData: FormData): Promise<RiskActionState> {
  return run(formData, "risks:manage", async (actor) => {
    const riskId = text(formData, "riskId");
    await unlinkRiskControl(getPrisma(), actor, { riskId, controlId: text(formData, "controlId") });
    return { success: "unlinked", riskId };
  });
}
