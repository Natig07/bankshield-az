import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertRolePermission, type Role } from "@/lib/auth/authorization";
import { findingStatusSchema, remediationStatusSchema, severitySchema } from "@/lib/domain/enums";
import { riskScore } from "@/lib/domain/risk";
import { assertEngagementOperation } from "@/lib/audits/service";
import {
  canAddRemediationAction,
  canTransitionFinding,
  canTransitionRemediation,
  isFindingEditable,
} from "./workflow";

type Actor = { id: string; role: Role };
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  })
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const score = z.number().int().min(1).max(5);

const findingFields = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(10).max(4_000),
    severity: severitySchema,
    requirementId: z.string().min(1).nullable(),
    inherentLikelihood: score.nullable(),
    inherentImpact: score.nullable(),
    residualLikelihood: score.nullable(),
    residualImpact: score.nullable(),
  })
  .superRefine((value, context) => {
    const pairs: [string, number | null, number | null][] = [
      ["inherentImpact", value.inherentLikelihood, value.inherentImpact],
      ["residualImpact", value.residualLikelihood, value.residualImpact],
    ];
    for (const [path, likelihood, impact] of pairs) {
      if ((likelihood === null) !== (impact === null)) {
        context.addIssue({ code: "custom", path: [path], message: "Likelihood and impact must be provided together." });
      }
    }
    if (value.residualLikelihood !== null && value.residualImpact !== null) {
      if (value.inherentLikelihood === null || value.inherentImpact === null) {
        context.addIssue({ code: "custom", path: ["residualImpact"], message: "Residual scores need inherent scores." });
      } else if (
        riskScore(value.residualLikelihood, value.residualImpact) >
        riskScore(value.inherentLikelihood, value.inherentImpact)
      ) {
        context.addIssue({ code: "custom", path: ["residualImpact"], message: "Residual risk cannot exceed inherent risk." });
      }
    }
  });

const createSchema = z.object({ engagementId: z.string().min(1) }).and(findingFields);
const updateSchema = z.object({ expectedUpdatedAt: z.number().int() }).and(findingFields);
const transitionSchema = z.object({
  targetStatus: findingStatusSchema,
  expectedUpdatedAt: z.number().int(),
  note: z.string().trim().max(1_000),
});
const actionSchema = z.object({
  findingId: z.string().min(1),
  ownerName: z.string().trim().min(2).max(120),
  actionPlan: z.string().trim().min(10).max(2_000),
  dueDate: calendarDate,
});
const actionStatusSchema = z.object({
  actionId: z.string().min(1),
  targetStatus: remediationStatusSchema,
  completionEvidenceId: z.string().min(1).nullable().optional(),
});

export class FindingNotFoundError extends Error {
  constructor() {
    super("The finding, requirement, evidence or action does not exist or is not accessible.");
    this.name = "FindingNotFoundError";
  }
}
export class StaleFindingError extends Error {
  constructor() {
    super("The finding changed since it was loaded. Reload and review the latest version.");
    this.name = "StaleFindingError";
  }
}
export class FindingLockedError extends Error {
  constructor() {
    super("This finding can no longer be changed in its current status.");
    this.name = "FindingLockedError";
  }
}
export class InvalidFindingTransitionError extends Error {
  constructor() {
    super("The requested status transition is not allowed.");
    this.name = "InvalidFindingTransitionError";
  }
}
export class FindingRuleError extends Error {
  constructor(
    readonly rule: "needsAction" | "actionsIncomplete" | "actionsUnverified" | "needsNote" | "independentClosure" | "ownerCannotVerify" | "invalidEvidence",
  ) {
    super(`Finding rule not met: ${rule}.`);
    this.name = "FindingRuleError";
  }
}

function event(actorId: string, action: string, entityType: string, entityId: string, detail: string) {
  return { actorId, action, entityType, entityId, outcome: "SUCCESS", detail };
}

// Non-administrators only reach findings of engagements they created or are members of.
// A miss is reported as "not found" so the existence of other engagements is not disclosed.
async function assertAccess(tx: Tx, actor: Actor, engagementId: string) {
  if (actor.role === "ADMINISTRATOR") return;
  const found = await tx.auditEngagement.findFirst({
    where: { id: engagementId, OR: [{ createdById: actor.id }, { members: { some: { userId: actor.id } } }] },
    select: { id: true },
  });
  if (!found) throw new FindingNotFoundError();
}

type FindingRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  requirementId: string | null;
  inherentLikelihood: number | null;
  inherentImpact: number | null;
  residualLikelihood: number | null;
  residualImpact: number | null;
  updatedAt: Date;
};

async function writeHistory(tx: Tx, finding: FindingRow, actorId: string, note: string | null) {
  await tx.auditFindingHistory.create({
    data: {
      findingId: finding.id,
      changedById: actorId,
      changeNote: note,
      snapshot: JSON.stringify({
        title: finding.title,
        severity: finding.severity,
        status: finding.status,
        requirementId: finding.requirementId,
        inherent: [finding.inherentLikelihood, finding.inherentImpact],
        residual: [finding.residualLikelihood, finding.residualImpact],
      }),
    },
  });
}

async function assertRequirementInScope(tx: Tx, engagementId: string, requirementId: string | null) {
  if (!requirementId) return;
  const selected = await tx.auditRequirementSelection.findFirst({
    where: { engagementId, requirementId },
    select: { id: true },
  });
  if (!selected) throw new FindingNotFoundError();
}

export async function createFinding(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "findings:manage");
  const { engagementId, ...data } = createSchema.parse(input);
  return db.$transaction(async (tx) => {
    await assertAccess(tx, actor, engagementId);
    await assertEngagementOperation(tx, engagementId, "manageFindings");
    await assertRequirementInScope(tx, engagementId, data.requirementId);
    const finding = await tx.auditFinding.create({ data: { ...data, engagementId, createdById: actor.id } });
    await writeHistory(tx, finding, actor.id, "Created");
    await tx.auditEvent.create({ data: event(actor.id, "FINDING_CREATED", "AuditFinding", finding.id, `severity ${finding.severity}`) });
    return { id: finding.id, engagementId };
  });
}

async function loadFinding(tx: Tx, actor: Actor, findingId: string) {
  const finding = await tx.auditFinding.findUnique({ where: { id: findingId } });
  if (!finding) throw new FindingNotFoundError();
  await assertAccess(tx, actor, finding.engagementId);
  return finding;
}

export async function updateFinding(db: PrismaClient, actor: Actor, findingId: string, input: unknown) {
  assertRolePermission(actor.role, "findings:manage");
  const { expectedUpdatedAt, ...data } = updateSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await loadFinding(tx, actor, findingId);
    await assertEngagementOperation(tx, current.engagementId, "manageFindings");
    if (current.updatedAt.getTime() !== expectedUpdatedAt) throw new StaleFindingError();
    if (!isFindingEditable(current.status)) throw new FindingLockedError();
    await assertRequirementInScope(tx, current.engagementId, data.requirementId);
    const changed = await tx.auditFinding.updateMany({
      where: { id: findingId, updatedAt: current.updatedAt, status: current.status },
      data,
    });
    if (changed.count !== 1) throw new StaleFindingError();
    const finding = await tx.auditFinding.findUniqueOrThrow({ where: { id: findingId } });
    await writeHistory(tx, finding, actor.id, "Updated");
    await tx.auditEvent.create({ data: event(actor.id, "FINDING_UPDATED", "AuditFinding", findingId, `severity ${finding.severity}`) });
    return { id: findingId, engagementId: finding.engagementId, updatedAt: finding.updatedAt.getTime() };
  });
}

export async function transitionFinding(db: PrismaClient, actor: Actor, findingId: string, input: unknown) {
  assertRolePermission(actor.role, "findings:manage");
  const data = transitionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await loadFinding(tx, actor, findingId);
    await assertEngagementOperation(tx, current.engagementId, "manageFindings");
    if (current.updatedAt.getTime() !== data.expectedUpdatedAt) throw new StaleFindingError();
    if (!canTransitionFinding(current.status, data.targetStatus)) throw new InvalidFindingTransitionError();

    const actions = await tx.remediationAction.findMany({ where: { findingId }, select: { status: true } });
    const patch: Record<string, unknown> = { status: data.targetStatus };
    switch (data.targetStatus) {
      case "IN_REMEDIATION":
        if (current.status === "READY_FOR_REVIEW") {
          if (data.note.length < 5) throw new FindingRuleError("needsNote");
        } else if (actions.length === 0) {
          throw new FindingRuleError("needsAction");
        }
        break;
      case "READY_FOR_REVIEW":
        if (actions.length === 0) throw new FindingRuleError("needsAction");
        if (actions.some(({ status }) => status !== "COMPLETED" && status !== "VERIFIED")) throw new FindingRuleError("actionsIncomplete");
        break;
      case "CLOSED":
        if (data.note.length < 5) throw new FindingRuleError("needsNote");
        if (actions.length === 0 || actions.some(({ status }) => status !== "VERIFIED")) throw new FindingRuleError("actionsUnverified");
        // Maker-checker: whoever raised the finding cannot be the one who closes it.
        if (current.createdById === actor.id) throw new FindingRuleError("independentClosure");
        Object.assign(patch, { approvedById: actor.id, approvedAt: new Date() });
        break;
    }
    const changed = await tx.auditFinding.updateMany({
      where: { id: findingId, updatedAt: current.updatedAt, status: current.status },
      data: patch,
    });
    if (changed.count !== 1) throw new StaleFindingError();
    const finding = await tx.auditFinding.findUniqueOrThrow({ where: { id: findingId } });
    await writeHistory(tx, finding, actor.id, data.note || `${current.status} -> ${data.targetStatus}`);
    await tx.auditEvent.create({
      data: event(actor.id, data.targetStatus === "CLOSED" ? "FINDING_CLOSED" : "FINDING_STATUS_CHANGED", "AuditFinding", findingId, `${current.status} -> ${data.targetStatus}`),
    });
    return { id: findingId, engagementId: finding.engagementId, updatedAt: finding.updatedAt.getTime() };
  });
}

export async function addRemediationAction(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "findings:manage");
  const data = actionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const finding = await loadFinding(tx, actor, data.findingId);
    await assertEngagementOperation(tx, finding.engagementId, "manageRemediation");
    if (!canAddRemediationAction(finding.status)) throw new FindingLockedError();
    const action = await tx.remediationAction.create({
      data: { findingId: data.findingId, ownerName: data.ownerName, actionPlan: data.actionPlan, dueDate: data.dueDate },
    });
    await tx.auditEvent.create({ data: event(actor.id, "REMEDIATION_ACTION_ADDED", "RemediationAction", action.id, `finding ${data.findingId}`) });
    return { id: action.id, findingId: data.findingId, engagementId: finding.engagementId };
  });
}

export async function updateRemediationStatus(db: PrismaClient, actor: Actor, input: unknown) {
  const data = actionStatusSchema.parse(input);
  // Verification is the independent check; doing the work needs the remediation permission.
  assertRolePermission(actor.role, data.targetStatus === "VERIFIED" ? "findings:manage" : "findings:remediate");
  return db.$transaction(async (tx) => {
    const action = await tx.remediationAction.findUnique({ where: { id: data.actionId } });
    if (!action) throw new FindingNotFoundError();
    const finding = await loadFinding(tx, actor, action.findingId);
    await assertEngagementOperation(tx, finding.engagementId, "manageRemediation");
    if (!canTransitionRemediation(action.status, data.targetStatus)) throw new InvalidFindingTransitionError();
    // Verifying belongs to a reviewer; sending an action back to work belongs to the finding review.
    const allowedFindingStatus = data.targetStatus === "VERIFIED" ? ["READY_FOR_REVIEW"] : data.targetStatus === "COMPLETED" ? ["IN_REMEDIATION"] : ["IN_REMEDIATION"];
    if (!allowedFindingStatus.includes(finding.status)) throw new FindingLockedError();

    const patch: Record<string, unknown> = { status: data.targetStatus };
    if (data.targetStatus === "COMPLETED") {
      if (data.completionEvidenceId) {
        const evidence = await tx.evidenceDocument.findFirst({
          where: { id: data.completionEvidenceId, engagementId: finding.engagementId, reviewStatus: { notIn: ["REJECTED", "SUPERSEDED"] } },
          select: { id: true },
        });
        if (!evidence) throw new FindingRuleError("invalidEvidence");
        patch.completionEvidenceId = evidence.id;
      }
      patch.completedAt = new Date();
    } else if (data.targetStatus === "VERIFIED") {
      if (action.ownerUserId && action.ownerUserId === actor.id) throw new FindingRuleError("ownerCannotVerify");
      patch.verifiedById = actor.id;
    } else if (data.targetStatus === "IN_PROGRESS" && action.status === "COMPLETED") {
      Object.assign(patch, { completedAt: null, completionEvidenceId: null });
    }
    const changed = await tx.remediationAction.updateMany({ where: { id: data.actionId, status: action.status }, data: patch });
    if (changed.count !== 1) throw new StaleFindingError();
    await tx.auditEvent.create({
      data: event(actor.id, "REMEDIATION_STATUS_CHANGED", "RemediationAction", data.actionId, `${action.status} -> ${data.targetStatus}`),
    });
    return { id: data.actionId, findingId: action.findingId, engagementId: finding.engagementId };
  });
}
