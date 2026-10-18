import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/lib/auth/authorization";
import { isDatabaseConstraintError } from "@/lib/auth/service";
import {
  canTransitionEngagementStatus,
  engagementAllows,
  type EngagementOperation,
} from "./workflow";

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

const participantSchema = z.object({
  engagementId: z.string().min(1),
  userId: z.string().min(1),
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

export class ApprovedAssessmentRequiredError extends Error {
  constructor() {
    super("An engagement needs at least one approved assessment before it can be approved.");
    this.name = "ApprovedAssessmentRequiredError";
  }
}

export class IndependentApproverRequiredError extends Error {
  constructor() {
    super("The engagement preparer cannot approve their own engagement.");
    this.name = "IndependentApproverRequiredError";
  }
}

export class EngagementRecordNotFoundError extends Error {
  constructor() {
    super("The engagement or selected record no longer exists.");
    this.name = "EngagementRecordNotFoundError";
  }
}

export class EngagementLockedError extends Error {
  constructor() {
    super("The engagement status does not allow this change.");
    this.name = "EngagementLockedError";
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

export class InvalidParticipantError extends Error {
  constructor() {
    super("The selected account is not an active security analyst participating in this engagement.");
    this.name = "InvalidParticipantError";
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

// Throws when the engagement is missing or its status does not allow `operation`.
// Callers run this inside the same transaction as the write it protects.
export async function assertEngagementOperation(
  db: Pick<PrismaClient, "auditEngagement">,
  engagementId: string,
  operation: EngagementOperation,
): Promise<void> {
  const engagement = await db.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { status: true },
  });
  if (!engagement) throw new EngagementRecordNotFoundError();
  if (!engagementAllows(engagement.status, operation)) throw new EngagementLockedError();
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
      select: { id: true, status: true, title: true, auditedOrganization: true, scope: true, periodStart: true, periodEnd: true },
    });
    if (!existing) throw new EngagementRecordNotFoundError();
    if (!engagementAllows(existing.status, "editEngagement")) throw new EngagementLockedError();
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

// An assessment counts as formally approved when it is the current revision of a scope item that
// belongs to this engagement and carries both approval markers (approveAssessment sets them together).
const APPROVED_CURRENT_ASSESSMENT = {
  isCurrent: true,
  approvedAt: { not: null },
  approvedById: { not: null },
} as const;

export async function transitionEngagement(db: PrismaClient, actorId: string, engagementId: string, targetStatus: string) {
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { status: true, createdById: true },
      });
      if (!current) throw new EngagementRecordNotFoundError();
      if (!canTransitionEngagementStatus(current.status, targetStatus)) throw new InvalidEngagementTransitionError();
      const approved = targetStatus === "APPROVED";
      if (approved && current.createdById === actorId) throw new IndependentApproverRequiredError();
      // The preconditions are part of the compare-and-set itself, so a concurrent change (for
      // example a revised assessment) cannot slip between the check and the update.
      const changed = await tx.auditEngagement.updateMany({
        where: {
          id: engagementId,
          status: current.status,
          ...(approved
            ? {
                createdById: { not: actorId },
                scopeItems: { some: { assessments: { some: APPROVED_CURRENT_ASSESSMENT } } },
              }
            : {}),
        },
        data: { status: targetStatus, ...(approved ? { approvedById: actorId, approvedAt: new Date() } : {}) },
      });
      if (changed.count !== 1) {
        if (approved) {
          const latest = await tx.auditEngagement.findUnique({
            where: { id: engagementId },
            select: { status: true, createdById: true },
          });
          if (latest && latest.status === current.status) {
            if (latest.createdById === actorId) throw new IndependentApproverRequiredError();
            throw new ApprovedAssessmentRequiredError();
          }
        }
        throw new InvalidEngagementTransitionError();
      }
      await tx.auditEvent.create({
        data: auditEvent(actorId, "AUDIT_ENGAGEMENT_STATUS_CHANGED", "AuditEngagement", engagementId, `${current.status} -> ${targetStatus}`),
      });
    });
  } catch (error) {
    if (error instanceof ApprovedAssessmentRequiredError || error instanceof IndependentApproverRequiredError) {
      // Recorded outside the rolled-back transaction so the refused attempt stays in the audit trail.
      await db.auditEvent
        .create({
          data: {
            ...auditEvent(
              actorId,
              "AUDIT_ENGAGEMENT_APPROVAL_REFUSED",
              "AuditEngagement",
              engagementId,
              error instanceof IndependentApproverRequiredError ? "preparer cannot approve" : "no approved assessment",
            ),
            outcome: "FAILURE",
          },
        })
        .catch(() => undefined);
    }
    throw error;
  }
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
      await assertEngagementOperation(tx, data.engagementId, "editEngagement");
      // Participants (security analysts) share this table; only the auditor slot is replaced.
      const assigned = await tx.auditEngagementMember.findMany({
        where: { engagementId: data.engagementId },
        orderBy: { createdAt: "asc" },
        select: { id: true, userId: true, user: { select: { role: true } } },
      });
      if (assigned.some(({ userId }) => userId === data.auditorId)) {
        throw new DuplicateEngagementRecordError();
      }
      const currentAssignment = assigned.find(({ user }) => user.role === "AUDITOR");
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
    await assertEngagementOperation(tx, data.engagementId, "editEngagement");
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

// Security analysts cannot own an engagement, but an administrator may add them as
// participants so they can upload evidence and record assessments for it.
export async function addEngagementParticipant(db: PrismaClient, actorId: string, input: unknown) {
  const data = participantSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      await assertEngagementOperation(tx, data.engagementId, "editEngagement");
      const analyst = await tx.user.findFirst({
        where: { id: data.userId, role: "SECURITY_ANALYST", isActive: true },
        select: { id: true },
      });
      if (!analyst) throw new InvalidParticipantError();
      const member = await tx.auditEngagementMember.create({
        data: { engagementId: data.engagementId, userId: data.userId },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: auditEvent(
          actorId,
          "AUDIT_ENGAGEMENT_PARTICIPANT_ADDED",
          "AuditEngagement",
          data.engagementId,
          `Participant added: ${data.userId}.`,
        ),
      });
      return member;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateEngagementRecordError();
    throw error;
  }
}

export async function removeEngagementParticipant(db: PrismaClient, actorId: string, input: unknown) {
  const data = participantSchema.parse(input);
  return db.$transaction(async (tx) => {
    await assertEngagementOperation(tx, data.engagementId, "editEngagement");
    const member = await tx.auditEngagementMember.findFirst({
      where: { engagementId: data.engagementId, userId: data.userId, user: { role: "SECURITY_ANALYST" } },
      select: { id: true },
    });
    // The auditor slot is never removed here; it can only be reassigned.
    if (!member) throw new InvalidParticipantError();
    await tx.auditEngagementMember.delete({ where: { id: member.id } });
    await tx.auditEvent.create({
      data: auditEvent(
        actorId,
        "AUDIT_ENGAGEMENT_PARTICIPANT_REMOVED",
        "AuditEngagement",
        data.engagementId,
        `Participant removed: ${data.userId}.`,
      ),
    });
  });
}
