import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { isDatabaseConstraintError } from "@/lib/auth/service";
import { REQUIREMENT_TYPES, VERIFICATION_STATUSES } from "@/lib/domain/enums";
import { canTransitionVerificationStatus } from "./workflow";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === null ? "" : value),
    z.string().trim().max(max).transform((value) => value || null),
  );

const optionalDate = z.preprocess(
  (value) => (value === undefined || value === null || value === "" ? null : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid calendar date.")
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, "Use a valid calendar date.")
    .nullable()
    .transform((value) => (value ? new Date(`${value}T00:00:00.000Z`) : null)),
);

const sourceUrl = z.string().trim().max(2048).refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}, "Use an absolute HTTP or HTTPS URL.");

const sourceMetadataFields = {
  title: z.string().trim().min(2).max(300),
  issuer: z.string().trim().min(2).max(200),
  sourceUrl,
  kind: z.enum(["MANDATORY_LAW", "OPTIONAL_FRAMEWORK"]),
  language: z.enum(["az", "en"]),
};

const versionMetadataFields = {
  versionLabel: z.string().trim().min(1).max(120),
  sourceUrl,
  decisionNumber: optionalText(120),
  decisionDate: optionalDate,
  effectiveFrom: optionalDate,
  effectiveTo: optionalDate,
};

function validateDateRange(
  value: { effectiveFrom: Date | null; effectiveTo: Date | null },
  context: z.RefinementCtx,
) {
  if (value.effectiveFrom && value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({
      code: "custom",
      path: ["effectiveTo"],
      message: "Effective end date must not precede the start date.",
    });
  }
}

export const createSourceSchema = z
  .object({
    ...sourceMetadataFields,
    ...versionMetadataFields,
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{1,79}$/),
  })
  .superRefine(validateDateRange);

export const updateSourceSchema = z.object({
  ...sourceMetadataFields,
  documentId: z.string().min(1),
});

export const addVersionSchema = z
  .object({ ...versionMetadataFields, documentId: z.string().min(1) })
  .superRefine(validateDateRange);

export const updateVersionSchema = z
  .object({
    ...versionMetadataFields,
    versionId: z.string().min(1),
  })
  .omit({ versionLabel: true })
  .superRefine(validateDateRange);

export const requirementMetadataSchema = z.object({
  clauseId: z.string().trim().min(1).max(120),
  section: optionalText(200),
  topic: optionalText(300),
  textOriginal: optionalText(20_000),
  textTranslation: optionalText(20_000),
  translationLabel: optionalText(200),
  translationSource: optionalText(500),
  applicability: optionalText(2_000),
  requirementType: z.enum(REQUIREMENT_TYPES),
});

export const createRequirementSchema = requirementMetadataSchema.extend({
  versionId: z.string().min(1),
});

export const updateRequirementSchema = requirementMetadataSchema.extend({
  requirementId: z.string().min(1),
});

export const verificationTransitionSchema = z.object({
  targetStatus: z.enum(VERIFICATION_STATUSES),
  note: z.string().trim().min(1).max(2_000),
});

export class DuplicateRegulatoryRecordError extends Error {
  constructor() {
    super("A regulatory record with the same source code, version label, or clause already exists.");
    this.name = "DuplicateRegulatoryRecordError";
  }
}

export class RegulatoryRecordNotFoundError extends Error {
  constructor() {
    super("The regulatory record no longer exists.");
    this.name = "RegulatoryRecordNotFoundError";
  }
}

export class InvalidVerificationTransitionError extends Error {
  constructor() {
    super("The requested verification status transition is not allowed.");
    this.name = "InvalidVerificationTransitionError";
  }
}

export class RegulatoryRecordLockedError extends Error {
  constructor() {
    super("A record can only be edited while its verification status is pending.");
    this.name = "RegulatoryRecordLockedError";
  }
}

export async function createRegulatorySource(db: PrismaClient, input: unknown) {
  const data = createSourceSchema.parse(input);
  try {
    return await db.regulatoryDocument.create({
      data: {
        code: data.code,
        title: data.title,
        issuer: data.issuer,
        sourceUrl: data.sourceUrl,
        kind: data.kind,
        language: data.language,
        versions: {
          create: {
            versionLabel: data.versionLabel,
            sourceUrl: data.sourceUrl,
            decisionNumber: data.decisionNumber,
            decisionDate: data.decisionDate,
            effectiveFrom: data.effectiveFrom,
            effectiveTo: data.effectiveTo,
            verificationStatus: "PENDING_VERIFICATION",
          },
        },
      },
      select: { id: true },
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) {
      throw new DuplicateRegulatoryRecordError();
    }
    throw error;
  }
}

export async function updateRegulatorySource(db: PrismaClient, input: unknown) {
  const data = updateSourceSchema.parse(input);
  try {
    return await db.regulatoryDocument.update({
      where: { id: data.documentId },
      data: {
        title: data.title,
        issuer: data.issuer,
        sourceUrl: data.sourceUrl,
        kind: data.kind,
        language: data.language,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2025")) throw new RegulatoryRecordNotFoundError();
    throw error;
  }
}

export async function addRegulatoryVersion(db: PrismaClient, input: unknown) {
  const data = addVersionSchema.parse(input);
  try {
    return await db.regulatoryVersion.create({
      data: {
        documentId: data.documentId,
        versionLabel: data.versionLabel,
        sourceUrl: data.sourceUrl,
        decisionNumber: data.decisionNumber,
        decisionDate: data.decisionDate,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
        verificationStatus: "PENDING_VERIFICATION",
      },
      select: { id: true },
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateRegulatoryRecordError();
    if (isDatabaseConstraintError(error, "P2003") || isDatabaseConstraintError(error, "P2025")) {
      throw new RegulatoryRecordNotFoundError();
    }
    throw error;
  }
}

export async function updateRegulatoryVersion(db: PrismaClient, input: unknown) {
  const data = updateVersionSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const version = await tx.regulatoryVersion.findUnique({
        where: { id: data.versionId },
        select: { verificationStatus: true },
      });
      if (!version) throw new RegulatoryRecordNotFoundError();
      if (version.verificationStatus !== "PENDING_VERIFICATION") {
        throw new RegulatoryRecordLockedError();
      }
      return tx.regulatoryVersion.update({
        where: { id: data.versionId },
        data: {
          sourceUrl: data.sourceUrl,
          decisionNumber: data.decisionNumber,
          decisionDate: data.decisionDate,
          effectiveFrom: data.effectiveFrom,
          effectiveTo: data.effectiveTo,
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2025")) throw new RegulatoryRecordNotFoundError();
    throw error;
  }
}

export async function createRegulatoryRequirement(db: PrismaClient, input: unknown) {
  const data = createRequirementSchema.parse(input);
  try {
    return await db.regulatoryRequirement.create({
      data: {
        versionId: data.versionId,
        clauseId: data.clauseId,
        section: data.section,
        topic: data.topic,
        textOriginal: data.textOriginal,
        textTranslation: data.textTranslation,
        translationLabel: data.translationLabel,
        translationSource: data.translationSource,
        applicability: data.applicability,
        requirementType: data.requirementType,
        verificationStatus: "PENDING_VERIFICATION",
        isDemo: false,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateRegulatoryRecordError();
    if (isDatabaseConstraintError(error, "P2003") || isDatabaseConstraintError(error, "P2025")) {
      throw new RegulatoryRecordNotFoundError();
    }
    throw error;
  }
}

export async function updateRegulatoryRequirement(db: PrismaClient, input: unknown) {
  const data = updateRequirementSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const requirement = await tx.regulatoryRequirement.findUnique({
        where: { id: data.requirementId },
        select: { verificationStatus: true },
      });
      if (!requirement) throw new RegulatoryRecordNotFoundError();
      if (requirement.verificationStatus !== "PENDING_VERIFICATION") {
        throw new RegulatoryRecordLockedError();
      }
      return tx.regulatoryRequirement.update({
        where: { id: data.requirementId },
        data: {
          clauseId: data.clauseId,
          section: data.section,
          topic: data.topic,
          textOriginal: data.textOriginal,
          textTranslation: data.textTranslation,
          translationLabel: data.translationLabel,
          translationSource: data.translationSource,
          applicability: data.applicability,
          requirementType: data.requirementType,
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateRegulatoryRecordError();
    if (isDatabaseConstraintError(error, "P2025")) throw new RegulatoryRecordNotFoundError();
    throw error;
  }
}

export async function transitionRegulatoryVersion(
  db: PrismaClient,
  versionId: string,
  actorId: string,
  input: unknown,
) {
  const { targetStatus, note } = verificationTransitionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const version = await tx.regulatoryVersion.findUnique({
      where: { id: versionId },
      select: { verificationStatus: true, verifiedById: true, verifiedAt: true },
    });
    if (!version) throw new RegulatoryRecordNotFoundError();
    if (!canTransitionVerificationStatus(version.verificationStatus, targetStatus)) {
      throw new InvalidVerificationTransitionError();
    }
    const now = new Date();
    const updated = await tx.regulatoryVersion.updateMany({
      where: { id: versionId, verificationStatus: version.verificationStatus },
      data: {
        verificationStatus: targetStatus,
        verificationNotes: note,
        verifiedById:
          targetStatus === "VERIFIED"
            ? actorId
            : targetStatus === "SUPERSEDED"
              ? version.verifiedById
              : null,
        verifiedAt:
          targetStatus === "VERIFIED"
            ? now
            : targetStatus === "SUPERSEDED"
              ? version.verifiedAt
              : null,
      },
    });
    if (updated.count !== 1) throw new InvalidVerificationTransitionError();
    await tx.verificationEvent.create({
      data: {
        versionId,
        actorId,
        fromStatus: version.verificationStatus,
        toStatus: targetStatus,
        note,
      },
    });
  });
}

export async function transitionRegulatoryRequirement(
  db: PrismaClient,
  requirementId: string,
  actorId: string,
  input: unknown,
) {
  const { targetStatus, note } = verificationTransitionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const requirement = await tx.regulatoryRequirement.findUnique({
      where: { id: requirementId },
      select: {
        verificationStatus: true,
        version: { select: { verificationStatus: true } },
      },
    });
    if (!requirement) throw new RegulatoryRecordNotFoundError();
    if (!canTransitionVerificationStatus(requirement.verificationStatus, targetStatus)) {
      throw new InvalidVerificationTransitionError();
    }
    if (targetStatus === "VERIFIED" && requirement.version.verificationStatus !== "VERIFIED") {
      throw new InvalidVerificationTransitionError();
    }
    const updated = await tx.regulatoryRequirement.updateMany({
      where: { id: requirementId, verificationStatus: requirement.verificationStatus },
      data: { verificationStatus: targetStatus },
    });
    if (updated.count !== 1) throw new InvalidVerificationTransitionError();
    await tx.verificationEvent.create({
      data: {
        requirementId,
        actorId,
        fromStatus: requirement.verificationStatus,
        toStatus: targetStatus,
        note,
      },
    });
  });
}
