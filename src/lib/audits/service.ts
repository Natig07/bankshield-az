import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/lib/auth/authorization";
import { isDatabaseConstraintError } from "@/lib/auth/service";
import { canTransitionEngagementStatus } from "./workflow";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  })
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const engagementFieldsSchema = z.object({
  title: z.string().trim().min(2).max(200),
  auditedOrganization: z.string().trim().min(2).max(200),
  scope: z.string().trim().min(2).max(5_000),
  periodStart: calendarDate,
  periodEnd: calendarDate,
});

function validatePeriod(
  value: { periodStart: Date; periodEnd: Date },
  context: z.RefinementCtx,
) {
  if (value.periodEnd < value.periodStart) {
    context.addIssue({
      code: "custom",
      path: ["periodEnd"],
      message: "Period end must not precede period start.",
    });
  }
}

export const engagementInputSchema = engagementFieldsSchema
  .extend({ assignedAuditorId: z.string().min(1) })
  .superRefine(validatePeriod);

export const updateEngagementSchema = engagementFieldsSchema.superRefine(validatePeriod);

const assignmentSchema = z.object({
  engagementId: z.string().min(1),
  auditorId: z.string().min(1),
});

const requirementSelectionSchema = z.object({
  engagementId: z.string().min(1),
  requirementId: z.string().min(1),
  acknowledgeUnverified: z.boolean(),
  decisionNote: z.string().trim().max(1_000),
});

export class InvalidEngagementTransitionError extends Error {
  constructor() {
    super("The requested engagement status transition is not allowed.");
    this.name = "InvalidEngagementTransitionError";
  }
}

export class EngagementRecordNotFoundError extends Error {
  constructor() {
    super("The engagement or selected record no longer exists.");
    this.name = "EngagementRecordNotFoundError";
  }
}

export class DuplicateEngagementRecordError extends Error {
  constructor() {
    super("This auditor or requirement is already assigned to the engagement.");
    this.name = "DuplicateEngagementRecordError";
  }
}

export class InvalidAuditorError extends Error {
  constructor() {
    super("The selected account is not an active auditor.");
    this.name = "InvalidAuditorError";
  }
}

export class UnverifiedRequirementDecisionError extends Error {
  constructor() {
    super("An explicit acknowledgement and decision note are required for unverified requirements.");
    this.name = "UnverifiedRequirementDecisionError";
  }
}

function auditEvent(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: string,
) {
  return {
    actorId,
    action,
    entityType,
    entityId,
    outcome: "SUCCESS",
    detail,
  };
}

async function assertAuditor(db: Pick<PrismaClient, "user">, auditorId: string) {
  const auditor = await db.user.findFirst({
    where: { id: auditorId, role: "AUDITOR", isActive: true },
    select: { id: true },
  });
  if (!auditor) throw new InvalidAuditorError();
}

export async function createEngagement(
  db: PrismaClient,
  actor: { id: string; role: Role },
  input: unknown,
) {
  const data = engagementInputSchema.parse(input);
  if (actor.role !== "ADMINISTRATOR" && data.assignedAuditorId !== actor.id) {
    throw new InvalidAuditorError();
  }

  return db.$transaction(async (tx) => {
    await assertAuditor(tx, data.assignedAuditorId);
    const engagement = await tx.auditEngagement.create({
      data: {
        title: data.title,
        auditedOrganization: data.auditedOrganization,
        scope: data.scope,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        createdById: actor.id,
        members: { create: { userId: data.assignedAuditorId } },
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: auditEvent(actor.id, "AUDIT_ENGAGEMENT_CREATED", "AuditEngagement", engagement.id, "Engagement created."),
    });
    return engagement;
  });
}

export async function updateEngagement(
  db: PrismaClient,
  actorId: string,
  engagementId: string,
  input: unknown,
) {
  const data = updateEngagementSchema.parse(input);
  return db.$transaction(async (tx) => {
    const existing = await tx.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { id: true, title: true, auditedOrganization: true, scope: true, periodStart: true, periodEnd: true },
    });
    if (!existing) throw new EngagementRecordNotFoundError();
    const changedFields = ([
      "title",
      "auditedOrganization",
      "scope",
      "periodStart",
      "periodEnd",
    ] as const).filter((field) => String(existing[field]) !== String(data[field]));
    const updated = await tx.auditEngagement.update({
      where: { id: engagementId },
      data: {
        title: data.title,
        auditedOrganization: data.auditedOrganization,
        scope: data.scope,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: auditEvent(
        actorId,
        "AUDIT_ENGAGEMENT_UPDATED",
        "AuditEngagement",
        engagementId,
        changedFields.length ? `Updated fields: ${changedFields.join(", ")}.` : "Engagement metadata saved.",
      ),
    });
    return updated;
  });
}

export async function transitionEngagement(
  db: PrismaClient,
  actorId: string,
  engagementId: string,
  targetStatus: string,
) {
  return db.$transaction(async (tx) => {
    const current = await tx.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { status: true },
    });
    if (!current) throw new EngagementRecordNotFoundError();
    if (!canTransitionEngagementStatus(current.status, targetStatus)) {
      throw new InvalidEngagementTransitionError();
    }
    const approved = targetStatus === "APPROVED";
    await tx.auditEngagement.update({
      where: { id: engagementId },
      data: {
        status: targetStatus,
        ...(approved ? { approvedById: actorId, approvedAt: new Date() } : {}),
      },
    });
    await tx.auditEvent.create({
      data: auditEvent(
        actorId,
        "AUDIT_ENGAGEMENT_STATUS_CHANGED",
        "AuditEngagement",
        engagementId,
        `${current.status} -> ${targetStatus}`,
      ),
    });
  });
}

export async function assignEngagementAuditor(
  db: PrismaClient,
  actorId: string,
  input: unknown,
) {
  const data = assignmentSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      await assertAuditor(tx, data.auditorId);
      if (!(await tx.auditEngagement.findUnique({ where: { id: data.engagementId }, select: { id: true } }))) {
        throw new EngagementRecordNotFoundError();
      }
      const assigned = await tx.auditEngagementMember.findMany({
        where: { engagementId: data.engagementId },
        orderBy: { createdAt: "asc" },
        select: { id: true, userId: true },
      });
      if (assigned.some(({ userId }) => userId === data.auditorId)) {
        throw new DuplicateEngagementRecordError();
      }
      const currentAssignment = assigned[0];
      const member = currentAssignment
        ? await tx.auditEngagementMember.update({
            where: { id: currentAssignment.id },
            data: { userId: data.auditorId },
            select: { id: true },
          })
        : await tx.auditEngagementMember.create({
            data: { engagementId: data.engagementId, userId: data.auditorId },
            select: { id: true },
          });
      await tx.auditEvent.create({
        data: auditEvent(
          actorId,
          "AUDIT_ENGAGEMENT_AUDITOR_ASSIGNED",
          "AuditEngagement",
          data.engagementId,
          currentAssignment
            ? `Assigned auditor changed from ${currentAssignment.userId} to ${data.auditorId}.`
            : `Auditor assigned: ${data.auditorId}.`,
        ),
      });
      return member;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateEngagementRecordError();
    if (isDatabaseConstraintError(error, "P2003") || isDatabaseConstraintError(error, "P2025")) {
      throw new EngagementRecordNotFoundError();
    }
    throw error;
  }
}

export async function selectEngagementRequirement(
  db: PrismaClient,
  actorId: string,
  input: unknown,
) {
  const data = requirementSelectionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const requirement = await tx.regulatoryRequirement.findFirst({
      where: { id: data.requirementId, isDemo: false },
      select: { verificationStatus: true },
    });
    if (!requirement) throw new EngagementRecordNotFoundError();
    const verified = requirement.verificationStatus === "VERIFIED";
    if (
      !verified &&
      (!data.acknowledgeUnverified || data.decisionNote.trim().length === 0)
    ) {
      throw new UnverifiedRequirementDecisionError();
    }
    try {
      const selection = await tx.auditRequirementSelection.create({
        data: {
          engagementId: data.engagementId,
          requirementId: data.requirementId,
          selectedById: actorId,
          verificationStatusAtSelection: requirement.verificationStatus,
          unverifiedAcknowledged: !verified && data.acknowledgeUnverified,
          decisionNote: data.decisionNote || null,
        },
        select: { id: true },
      });
      const mappings = await tx.requirementControlMapping.findMany({
        where: { requirementId: data.requirementId },
        select: { controlId: true },
      });
      const existingScope = await tx.auditScopeItem.findMany({
        where: { engagementId: data.engagementId, requirementId: data.requirementId },
        select: { controlId: true },
      });
      const existingControlIds = new Set(existingScope.map(({ controlId }) => controlId));
      const scopeItems = mappings
        .filter(({ controlId }) => !existingControlIds.has(controlId))
        .map(({ controlId }) => ({
          engagementId: data.engagementId,
          requirementId: data.requirementId,
          controlId,
        }));
      if (scopeItems.length > 0) {
        await tx.auditScopeItem.createMany({ data: scopeItems });
      }
      await tx.auditEvent.create({
        data: auditEvent(
          actorId,
          "AUDIT_REQUIREMENT_SELECTED",
          "AuditEngagement",
          data.engagementId,
          `Requirement selected; verification status: ${requirement.verificationStatus}; unverified acknowledged: ${!verified && data.acknowledgeUnverified}.`,
        ),
      });
      return selection;
    } catch (error) {
      if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateEngagementRecordError();
      if (isDatabaseConstraintError(error, "P2003") || isDatabaseConstraintError(error, "P2025")) {
        throw new EngagementRecordNotFoundError();
      }
      throw error;
    }
  });
}
