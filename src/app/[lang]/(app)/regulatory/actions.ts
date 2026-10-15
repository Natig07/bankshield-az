"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { hasLocale } from "@/i18n/config";
import { requirePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  addRegulatoryVersion,
  createRegulatoryRequirement,
  createRegulatorySource,
  DuplicateRegulatoryRecordError,
  InvalidVerificationTransitionError,
  RegulatoryRecordLockedError,
  RegulatoryRecordNotFoundError,
  transitionRegulatoryRequirement,
  transitionRegulatoryVersion,
  updateRegulatoryRequirement,
  updateRegulatorySource,
  updateRegulatoryVersion,
} from "@/lib/regulatory/service";

export type RegulatoryActionState = {
  error?: "invalidInput" | "duplicate" | "notFound" | "invalidTransition" | "recordLocked";
  success?: "saved" | "statusUpdated";
} | null;

async function runAction(
  langValue: FormDataEntryValue | null,
  operation: (actorId: string) => Promise<unknown>,
  success: "saved" | "statusUpdated" = "saved",
): Promise<RegulatoryActionState> {
  const actor = await requirePermission("regulatory:manage");
  if (typeof langValue !== "string" || !hasLocale(langValue)) return { error: "invalidInput" };

  try {
    await operation(actor.id);
  } catch (error) {
    if (error instanceof ZodError) return { error: "invalidInput" };
    if (error instanceof DuplicateRegulatoryRecordError) return { error: "duplicate" };
    if (error instanceof RegulatoryRecordNotFoundError) return { error: "notFound" };
    if (error instanceof InvalidVerificationTransitionError) return { error: "invalidTransition" };
    if (error instanceof RegulatoryRecordLockedError) return { error: "recordLocked" };
    throw error;
  }

  revalidatePath(`/${langValue}/regulatory`);
  revalidatePath(`/${langValue}`);
  return { success };
}

function value(formData: FormData, name: string): string {
  const entry = formData.get(name);
  return typeof entry === "string" ? entry : "";
}

export async function createSourceAction(
  _previousState: RegulatoryActionState,
  formData: FormData,
): Promise<RegulatoryActionState> {
  return runAction(formData.get("lang"), async () => createRegulatorySource(getPrisma(), {
    code: value(formData, "code"),
    title: value(formData, "title"),
    issuer: value(formData, "issuer"),
    sourceUrl: value(formData, "sourceUrl"),
    kind: value(formData, "kind"),
    language: value(formData, "language"),
    versionLabel: value(formData, "versionLabel"),
    decisionNumber: value(formData, "decisionNumber"),
    decisionDate: value(formData, "decisionDate"),
    effectiveFrom: value(formData, "effectiveFrom"),
    effectiveTo: value(formData, "effectiveTo"),
  }));
}

export async function updateSourceAction(
  _previousState: RegulatoryActionState,
  formData: FormData,
): Promise<RegulatoryActionState> {
  return runAction(formData.get("lang"), async () => updateRegulatorySource(getPrisma(), {
    documentId: value(formData, "documentId"),
    title: value(formData, "title"),
    issuer: value(formData, "issuer"),
    sourceUrl: value(formData, "sourceUrl"),
    kind: value(formData, "kind"),
    language: value(formData, "language"),
  }));
}

export async function addVersionAction(
  _previousState: RegulatoryActionState,
  formData: FormData,
): Promise<RegulatoryActionState> {
  return runAction(formData.get("lang"), async () => addRegulatoryVersion(getPrisma(), {
    documentId: value(formData, "documentId"),
    versionLabel: value(formData, "versionLabel"),
    sourceUrl: value(formData, "sourceUrl"),
    decisionNumber: value(formData, "decisionNumber"),
    decisionDate: value(formData, "decisionDate"),
    effectiveFrom: value(formData, "effectiveFrom"),
    effectiveTo: value(formData, "effectiveTo"),
  }));
}

export async function updateVersionAction(
  _previousState: RegulatoryActionState,
  formData: FormData,
): Promise<RegulatoryActionState> {
  return runAction(formData.get("lang"), async () => updateRegulatoryVersion(getPrisma(), {
    versionId: value(formData, "versionId"),
    sourceUrl: value(formData, "sourceUrl"),
    decisionNumber: value(formData, "decisionNumber"),
    decisionDate: value(formData, "decisionDate"),
    effectiveFrom: value(formData, "effectiveFrom"),
    effectiveTo: value(formData, "effectiveTo"),
  }));
}

export async function createRequirementAction(
  _previousState: RegulatoryActionState,
  formData: FormData,
): Promise<RegulatoryActionState> {
  return runAction(formData.get("lang"), async () => createRegulatoryRequirement(getPrisma(), {
    versionId: value(formData, "versionId"),
    clauseId: value(formData, "clauseId"),
    section: value(formData, "section"),
    topic: value(formData, "topic"),
    textOriginal: value(formData, "textOriginal"),
    textTranslation: value(formData, "textTranslation"),
    translationLabel: value(formData, "translationLabel"),
    translationSource: value(formData, "translationSource"),
    applicability: value(formData, "applicability"),
    requirementType: value(formData, "requirementType"),
  }));
}

export async function updateRequirementAction(
  _previousState: RegulatoryActionState,
  formData: FormData,
): Promise<RegulatoryActionState> {
  return runAction(formData.get("lang"), async () => updateRegulatoryRequirement(getPrisma(), {
    requirementId: value(formData, "requirementId"),
    clauseId: value(formData, "clauseId"),
    section: value(formData, "section"),
    topic: value(formData, "topic"),
    textOriginal: value(formData, "textOriginal"),
    textTranslation: value(formData, "textTranslation"),
    translationLabel: value(formData, "translationLabel"),
    translationSource: value(formData, "translationSource"),
    applicability: value(formData, "applicability"),
    requirementType: value(formData, "requirementType"),
  }));
}

export async function transitionVersionAction(
  _previousState: RegulatoryActionState,
  formData: FormData,
): Promise<RegulatoryActionState> {
  return runAction(
    formData.get("lang"),
    (actorId) => transitionRegulatoryVersion(
      getPrisma(),
      value(formData, "versionId"),
      actorId,
      { targetStatus: value(formData, "targetStatus"), note: value(formData, "note") },
    ),
    "statusUpdated",
  );
}

export async function transitionRequirementAction(
  _previousState: RegulatoryActionState,
  formData: FormData,
): Promise<RegulatoryActionState> {
  return runAction(
    formData.get("lang"),
    (actorId) => transitionRegulatoryRequirement(
      getPrisma(),
      value(formData, "requirementId"),
      actorId,
      { targetStatus: value(formData, "targetStatus"), note: value(formData, "note") },
    ),
    "statusUpdated",
  );
}
