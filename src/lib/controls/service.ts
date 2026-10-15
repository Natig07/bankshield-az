import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertRolePermission, type Role } from "@/lib/auth/authorization";
import { validateApproval, validateAssessment } from "@/lib/domain/assessment";
import { assessmentStatusSchema } from "@/lib/domain/enums";
import { isDatabaseConstraintError } from "@/lib/auth/service";

const controlSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).transform((value) => value.toUpperCase()),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4_000).nullable(),
  domain: z.string().trim().max(120).nullable(),
  source: z.enum(["INTERNAL", "ISO_27001", "NIST_CSF"]),
});

const mappingSchema = z.object({
  controlId: z.string().min(1),
  requirementId: z.string().min(1),
  rationale: z.string().trim().min(10).max(2_000),
});

const assessmentRevisionSchema = z.object({
  status: assessmentStatusSchema,
  notApplicableReason: z.string().trim().max(2_000).nullable(),
  evidenceIds: z.array(z.string().min(1)).max(50).default([]),
}).superRefine((input, context) => {
  const errors = validateAssessment(input);
  if (errors.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["notApplicableReason"],
      message: errors.join(" "),
    });
  }
  if (new Set(input.evidenceIds).size !== input.evidenceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["evidenceIds"],
      message: "Evidence cannot be linked more than once.",
    });
  }
});

const approvalSchema = z.object({
  justification: z.string().trim().min(10).max(2_000),
});

export class DuplicateControlRecordError extends Error {
  constructor() {
    super("A control with this code already exists.");
    this.name = "DuplicateControlRecordError";
  }
}

export class ControlRecordNotFoundError extends Error {
  constructor() {
    super("The control, requirement, or assessment no longer exists.");
    this.name = "ControlRecordNotFoundError";
  }
}

export class DuplicateRequirementMappingError extends Error {
  constructor() {
    super("This requirement is already mapped to the control.");
    this.name = "DuplicateRequirementMappingError";
  }
}

export class InvalidAssessmentEvidenceError extends Error {
  constructor() {
    super("Evidence must belong to this engagement and be relevant to this control.");
    this.name = "InvalidAssessmentEvidenceError";
  }
}

export class InvalidAssessmentApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAssessmentApprovalError";
  }
}

export class InvalidAssessmentTransitionError extends Error {
  constructor() {
    super("An approved or superseded assessment cannot be changed in place.");
    this.name = "InvalidAssessmentTransitionError";
  }
}

export class ConcurrentAssessmentRevisionError extends Error {
  constructor() {
    super("Another assessment revision was saved concurrently. Reload and try again.");
    this.name = "ConcurrentAssessmentRevisionError";
  }
}

function logEvent(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: string,
) {
  return { actorId, action, entityType, entityId, outcome: "SUCCESS", detail };
}

export async function createControl(db: PrismaClient, actor: { id: string; role: Role }, input: unknown) {
  assertRolePermission(actor.role, "controls:manage");
  const data = controlSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const control = await tx.cybersecurityControl.create({
        data: {
          code: data.code,
          title: data.title,
          description: data.description || null,
          domain: data.domain || null,
          source: data.source,
        },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: logEvent(actor.id, "CONTROL_CREATED", "CybersecurityControl", control.id, `Control ${data.code} created.`),
      });
      return control;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateControlRecordError();
    throw error;
  }
}

export async function updateControl(
  db: PrismaClient,
  actor: { id: string; role: Role },
  controlId: string,
  input: unknown,
) {
  assertRolePermission(actor.role, "controls:manage");
  const data = controlSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const control = await tx.cybersecurityControl.update({
        where: { id: controlId },
        data: {
          code: data.code,
          title: data.title,
          description: data.description || null,
          domain: data.domain || null,
          source: data.source,
        },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: logEvent(actor.id, "CONTROL_UPDATED", "CybersecurityControl", control.id, `Control ${data.code} updated.`),
      });
      return control;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateControlRecordError();
    if (isDatabaseConstraintError(error, "P2025")) throw new ControlRecordNotFoundError();
    throw error;
  }
}

export async function createRequirementControlMapping(
  db: PrismaClient,
  actor: { id: string; role: Role },
  input: unknown,
) {
  assertRolePermission(actor.role, "controls:manage");
  const data = mappingSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const [control, requirement] = await Promise.all([
        tx.cybersecurityControl.findUnique({ where: { id: data.controlId }, select: { id: true, code: true } }),
        tx.regulatoryRequirement.findFirst({
          where: { id: data.requirementId, isDemo: false },
          select: { id: true, clauseId: true, verificationStatus: true },
        }),
      ]);
      if (!control || !requirement) throw new ControlRecordNotFoundError();
      const mapping = await tx.requirementControlMapping.create({
        data: {
          controlId: control.id,
          requirementId: requirement.id,
          rationale: data.rationale,
          mappedById: actor.id,
        },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: logEvent(
          actor.id,
          "REQUIREMENT_CONTROL_MAPPED",
          "RequirementControlMapping",
          mapping.id,
          `${requirement.clauseId} mapped to ${control.code}; requirement verification remains ${requirement.verificationStatus}.`,
        ),
      });
      return mapping;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateRequirementMappingError();
    if (isDatabaseConstraintError(error, "P2003") || isDatabaseConstraintError(error, "P2025")) {
      throw new ControlRecordNotFoundError();
    }
    throw error;
  }
}

export async function createAssessmentRevision(
  db: PrismaClient,
  actor: { id: string; role: Role },
  engagementId: string,
  scopeItemId: string,
  input: unknown,
) {
  assertRolePermission(actor.role, "controls:assess");
  const data = assessmentRevisionSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const scopeItem = await tx.auditScopeItem.findUnique({
        where: { id: scopeItemId },
        select: { id: true, engagementId: true, controlId: true },
      });
      if (!scopeItem || scopeItem.engagementId !== engagementId) throw new ControlRecordNotFoundError();

      if (data.evidenceIds.length) {
        const validEvidence = await tx.evidenceDocument.findMany({
          where: {
            id: { in: data.evidenceIds },
            engagementId: scopeItem.engagementId,
            OR: [{ controlId: null }, { controlId: scopeItem.controlId }],
          },
          select: { id: true },
        });
        if (validEvidence.length !== data.evidenceIds.length) throw new InvalidAssessmentEvidenceError();
      }

      const latest = await tx.controlAssessment.findFirst({
        where: { scopeItemId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      await tx.controlAssessment.updateMany({
        where: { scopeItemId, isCurrent: true },
        data: { isCurrent: false },
      });
      const assessment = await tx.controlAssessment.create({
        data: {
          scopeItemId,
          version: (latest?.version ?? 0) + 1,
          status: data.status,
          notApplicableReason: data.status === "NOT_APPLICABLE" ? data.notApplicableReason : null,
          assessedById: actor.id,
          evidenceLinks: {
            create: data.evidenceIds.map((evidenceId) => ({
              evidenceId,
              linkedById: actor.id,
            })),
          },
        },
        select: { id: true, version: true, status: true },
      });
      await tx.auditEvent.create({
        data: logEvent(
          actor.id,
          "CONTROL_ASSESSMENT_REVISED",
          "AuditEngagement",
          engagementId,
          `Assessment ${assessment.id}, revision ${assessment.version}, recorded with status ${assessment.status}.`,
        ),
      });
      return assessment;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new ConcurrentAssessmentRevisionError();
    if (isDatabaseConstraintError(error, "P2003") || isDatabaseConstraintError(error, "P2025")) {
      throw new ControlRecordNotFoundError();
    }
    throw error;
  }
}

export async function approveAssessment(
  db: PrismaClient,
  actor: { id: string; role: Role },
  engagementId: string,
  assessmentId: string,
  input: unknown,
) {
  assertRolePermission(actor.role, "controls:assess");
  const data = approvalSchema.parse(input);
  return db.$transaction(async (tx) => {
    const assessment = await tx.controlAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        status: true,
        notApplicableReason: true,
        isCurrent: true,
        approvedAt: true,
        scopeItem: { select: { engagementId: true } },
        _count: { select: { evidenceLinks: true } },
      },
    });
    if (!assessment || assessment.scopeItem.engagementId !== engagementId) throw new ControlRecordNotFoundError();
    if (!assessment.isCurrent || assessment.approvedAt) throw new InvalidAssessmentTransitionError();
    const errors = validateApproval({
      status: assessmentStatusSchema.parse(assessment.status),
      justification: data.justification,
      linkedEvidenceCount: assessment._count.evidenceLinks,
      notApplicableReason: assessment.notApplicableReason,
    });
    if (errors.length) throw new InvalidAssessmentApprovalError(errors.join(" "));

    const changed = await tx.controlAssessment.updateMany({
      where: { id: assessment.id, isCurrent: true, approvedAt: null },
      data: { justification: data.justification, approvedById: actor.id, approvedAt: new Date() },
    });
    if (changed.count !== 1) throw new InvalidAssessmentTransitionError();
    await tx.auditEvent.create({
      data: logEvent(
        actor.id,
        "CONTROL_ASSESSMENT_APPROVED",
        "AuditEngagement",
        engagementId,
        `Assessment ${assessment.id} approved.`,
      ),
    });
    return { id: assessment.id };
  });
}
