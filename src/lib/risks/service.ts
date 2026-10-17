import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertRolePermission, type Role } from "@/lib/auth/authorization";
import { isDatabaseConstraintError } from "@/lib/auth/service";
import {
  assetTypeSchema,
  riskCategorySchema,
  riskStatusSchema,
  riskTreatmentSchema,
  severitySchema,
  treatmentActionStatusSchema,
} from "@/lib/domain/enums";
import { riskScore } from "@/lib/domain/risk";
import {
  canTransitionRisk,
  canTransitionTreatmentAction,
  isRiskEditable,
  isTreatmentActionActive,
} from "./workflow";

type Actor = { id: string; role: Role };

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  })
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const score = z.number().int().min(1).max(5);
const optionalScore = score.nullable();

const code = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((value) => value.toUpperCase());

const assetSchema = z.object({
  code,
  name: z.string().trim().min(2).max(200),
  assetType: assetTypeSchema,
  criticality: severitySchema,
  ownerName: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2_000).nullable(),
  isActive: z.boolean().default(true),
});

const riskFieldsSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(4_000),
  category: riskCategorySchema,
  assetId: z.string().min(1).nullable(),
  ownerName: z.string().trim().min(2).max(120),
  inherentLikelihood: score,
  inherentImpact: score,
  residualLikelihood: optionalScore,
  residualImpact: optionalScore,
  treatment: riskTreatmentSchema.nullable(),
  reviewDate: calendarDate.nullable(),
});

function validateScores(
  value: { inherentLikelihood: number; inherentImpact: number; residualLikelihood: number | null; residualImpact: number | null },
  context: z.RefinementCtx,
) {
  const hasLikelihood = value.residualLikelihood !== null;
  const hasImpact = value.residualImpact !== null;
  if (hasLikelihood !== hasImpact) {
    context.addIssue({ code: "custom", path: ["residualImpact"], message: "Residual likelihood and impact must be provided together." });
    return;
  }
  if (value.residualLikelihood !== null && value.residualImpact !== null) {
    const inherent = riskScore(value.inherentLikelihood, value.inherentImpact);
    const residual = riskScore(value.residualLikelihood, value.residualImpact);
    if (residual > inherent) {
      context.addIssue({ code: "custom", path: ["residualImpact"], message: "Residual risk cannot exceed inherent risk." });
    }
  }
}

export const createRiskSchema = riskFieldsSchema.superRefine(validateScores);
export const updateRiskSchema = riskFieldsSchema
  .extend({ expectedRevision: z.number().int().min(1) })
  .superRefine(validateScores);

const transitionSchema = z.object({
  targetStatus: riskStatusSchema,
  expectedRevision: z.number().int().min(1),
  note: z.string().trim().max(2_000),
  acceptanceJustification: z.string().trim().max(2_000).optional(),
});

const treatmentActionSchema = z.object({
  riskId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2_000).nullable(),
  ownerName: z.string().trim().min(2).max(120),
  dueDate: calendarDate,
});

const actionStatusSchema = z.object({
  actionId: z.string().min(1),
  targetStatus: treatmentActionStatusSchema,
});

const controlLinkSchema = z.object({ riskId: z.string().min(1), controlId: z.string().min(1) });

export class RiskNotFoundError extends Error {
  constructor() {
    super("The risk, asset, control or action no longer exists.");
    this.name = "RiskNotFoundError";
  }
}
export class DuplicateRiskRecordError extends Error {
  constructor() {
    super("A record with this code or link already exists.");
    this.name = "DuplicateRiskRecordError";
  }
}
export class StaleRiskError extends Error {
  constructor() {
    super("The risk changed since it was loaded. Reload and review the latest version.");
    this.name = "StaleRiskError";
  }
}
export class RiskLockedError extends Error {
  constructor() {
    super("This risk is not open for editing. Reopen it first.");
    this.name = "RiskLockedError";
  }
}
export class InvalidRiskTransitionError extends Error {
  constructor() {
    super("The requested risk status transition is not allowed.");
    this.name = "InvalidRiskTransitionError";
  }
}
export class RiskTransitionRuleError extends Error {
  constructor(readonly rule: "needsTreatment" | "needsAction" | "needsJustification" | "needsResidual" | "needsReviewDate" | "openActions" | "needsNote") {
    super(`Risk transition rule not met: ${rule}.`);
    this.name = "RiskTransitionRuleError";
  }
}
export class InvalidRiskAssetError extends Error {
  constructor() {
    super("Select an active asset.");
    this.name = "InvalidRiskAssetError";
  }
}

function event(actorId: string, action: string, entityType: string, entityId: string, detail: string) {
  return { actorId, action, entityType, entityId, outcome: "SUCCESS", detail };
}

type RiskRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  assetId: string | null;
  ownerName: string;
  inherentLikelihood: number;
  inherentImpact: number;
  residualLikelihood: number | null;
  residualImpact: number | null;
  status: string;
  treatment: string | null;
  acceptanceJustification: string | null;
  acceptedById: string | null;
  acceptedAt: Date | null;
  reviewDate: Date | null;
  revision: number;
};

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function writeHistory(tx: Tx, risk: RiskRow, actorId: string, note: string | null) {
  await tx.riskHistory.create({
    data: {
      riskId: risk.id,
      revision: risk.revision,
      changedById: actorId,
      changeNote: note,
      snapshot: JSON.stringify({
        code: risk.code,
        title: risk.title,
        category: risk.category,
        assetId: risk.assetId,
        ownerName: risk.ownerName,
        inherent: [risk.inherentLikelihood, risk.inherentImpact],
        residual: [risk.residualLikelihood, risk.residualImpact],
        status: risk.status,
        treatment: risk.treatment,
        acceptedById: risk.acceptedById,
        acceptedAt: risk.acceptedAt?.toISOString() ?? null,
        reviewDate: risk.reviewDate?.toISOString() ?? null,
      }),
    },
  });
}

async function assertActiveAsset(tx: Tx, assetId: string | null) {
  if (!assetId) return;
  const asset = await tx.asset.findFirst({ where: { id: assetId, isActive: true }, select: { id: true } });
  if (!asset) throw new InvalidRiskAssetError();
}

// ───────────── assets ─────────────

export async function createAsset(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const data = assetSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: { ...data, description: data.description || null, createdById: actor.id },
        select: { id: true },
      });
      await tx.auditEvent.create({ data: event(actor.id, "ASSET_CREATED", "Asset", asset.id, `Asset ${data.code} created.`) });
      return asset;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateRiskRecordError();
    throw error;
  }
}

export async function updateAsset(db: PrismaClient, actor: Actor, assetId: string, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const data = assetSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const asset = await tx.asset.update({
        where: { id: assetId },
        data: { ...data, description: data.description || null },
        select: { id: true },
      });
      await tx.auditEvent.create({ data: event(actor.id, "ASSET_UPDATED", "Asset", asset.id, `Asset ${data.code} updated.`) });
      return asset;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateRiskRecordError();
    if (isDatabaseConstraintError(error, "P2025")) throw new RiskNotFoundError();
    throw error;
  }
}

// ───────────── risks ─────────────

export async function createRisk(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const data = createRiskSchema.parse(input);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        await assertActiveAsset(tx, data.assetId);
        // Risks are never deleted, so the count yields the next free sequence number.
        const riskCode = `RSK-${String((await tx.risk.count()) + 1).padStart(4, "0")}`;
        const risk = await tx.risk.create({ data: { ...data, code: riskCode, createdById: actor.id } });
        await writeHistory(tx, risk, actor.id, "Risk registered.");
        await tx.auditEvent.create({ data: event(actor.id, "RISK_CREATED", "Risk", risk.id, `Risk ${riskCode} registered.`) });
        return { id: risk.id, code: riskCode };
      });
    } catch (error) {
      if (isDatabaseConstraintError(error, "P2002") && attempt < 2) continue;
      if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateRiskRecordError();
      throw error;
    }
  }
}

export async function updateRisk(db: PrismaClient, actor: Actor, riskId: string, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const { expectedRevision, ...data } = updateRiskSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await tx.risk.findUnique({ where: { id: riskId }, select: { status: true, revision: true } });
    if (!current) throw new RiskNotFoundError();
    if (!isRiskEditable(current.status)) throw new RiskLockedError();
    if (current.revision !== expectedRevision) throw new StaleRiskError();
    await assertActiveAsset(tx, data.assetId);
    const changed = await tx.risk.updateMany({
      where: { id: riskId, revision: expectedRevision },
      data: { ...data, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new StaleRiskError();
    const risk = await tx.risk.findUniqueOrThrow({ where: { id: riskId } });
    await writeHistory(tx, risk, actor.id, "Risk updated.");
    await tx.auditEvent.create({ data: event(actor.id, "RISK_UPDATED", "Risk", riskId, `Risk ${risk.code} updated to revision ${risk.revision}.`) });
    return { id: riskId, revision: risk.revision };
  });
}

export async function transitionRisk(db: PrismaClient, actor: Actor, riskId: string, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const data = transitionSchema.parse(input);
  if (data.targetStatus === "ACCEPTED") assertRolePermission(actor.role, "risks:accept");
  return db.$transaction(async (tx) => {
    const current = await tx.risk.findUnique({ where: { id: riskId } });
    if (!current) throw new RiskNotFoundError();
    if (current.revision !== data.expectedRevision) throw new StaleRiskError();
    if (!canTransitionRisk(current.status, data.targetStatus)) throw new InvalidRiskTransitionError();

    const actions = await tx.riskTreatmentAction.findMany({ where: { riskId }, select: { status: true } });
    const patch: Record<string, unknown> = { status: data.targetStatus };
    switch (data.targetStatus) {
      case "IN_TREATMENT":
        if (!current.treatment || current.treatment === "ACCEPT") throw new RiskTransitionRuleError("needsTreatment");
        if (!actions.some(({ status }) => status !== "CANCELLED")) throw new RiskTransitionRuleError("needsAction");
        break;
      case "ACCEPTED": {
        const justification = data.acceptanceJustification?.trim() ?? "";
        if (justification.length < 10) throw new RiskTransitionRuleError("needsJustification");
        if (current.residualLikelihood === null || current.residualImpact === null) throw new RiskTransitionRuleError("needsResidual");
        if (!current.reviewDate || current.reviewDate.getTime() <= Date.now()) throw new RiskTransitionRuleError("needsReviewDate");
        Object.assign(patch, { treatment: "ACCEPT", acceptanceJustification: justification, acceptedById: actor.id, acceptedAt: new Date() });
        break;
      }
      case "CLOSED":
        if (data.note.length < 5) throw new RiskTransitionRuleError("needsNote");
        if (actions.some(({ status }) => isTreatmentActionActive(status))) throw new RiskTransitionRuleError("openActions");
        break;
      case "OPEN":
        if (data.note.length < 5) throw new RiskTransitionRuleError("needsNote");
        // Leaving ACCEPTED withdraws the acceptance; the history keeps the original decision.
        Object.assign(patch, { acceptanceJustification: null, acceptedById: null, acceptedAt: null });
        break;
    }
    const changed = await tx.risk.updateMany({
      where: { id: riskId, revision: data.expectedRevision, status: current.status },
      data: { ...patch, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new StaleRiskError();
    const risk = await tx.risk.findUniqueOrThrow({ where: { id: riskId } });
    await writeHistory(tx, risk, actor.id, data.note || data.acceptanceJustification || `${current.status} -> ${data.targetStatus}`);
    await tx.auditEvent.create({
      data: event(
        actor.id,
        data.targetStatus === "ACCEPTED" ? "RISK_ACCEPTED" : "RISK_STATUS_CHANGED",
        "Risk",
        riskId,
        `${current.status} -> ${data.targetStatus}`,
      ),
    });
    return { id: riskId, revision: risk.revision };
  });
}

// ───────────── control links ─────────────

export async function linkRiskControl(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const data = controlLinkSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const [risk, control] = await Promise.all([
        tx.risk.findUnique({ where: { id: data.riskId }, select: { id: true, status: true, code: true } }),
        tx.cybersecurityControl.findUnique({ where: { id: data.controlId }, select: { id: true, code: true } }),
      ]);
      if (!risk || !control) throw new RiskNotFoundError();
      if (!isRiskEditable(risk.status)) throw new RiskLockedError();
      const link = await tx.riskControl.create({ data: { ...data, linkedById: actor.id }, select: { id: true } });
      await tx.auditEvent.create({ data: event(actor.id, "RISK_CONTROL_LINKED", "Risk", risk.id, `${risk.code} linked to control ${control.code}.`) });
      return link;
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) throw new DuplicateRiskRecordError();
    throw error;
  }
}

export async function unlinkRiskControl(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const data = controlLinkSchema.parse(input);
  return db.$transaction(async (tx) => {
    const link = await tx.riskControl.findUnique({
      where: { riskId_controlId: data },
      select: { id: true, risk: { select: { status: true, code: true } }, control: { select: { code: true } } },
    });
    if (!link) throw new RiskNotFoundError();
    if (!isRiskEditable(link.risk.status)) throw new RiskLockedError();
    await tx.riskControl.delete({ where: { id: link.id } });
    await tx.auditEvent.create({ data: event(actor.id, "RISK_CONTROL_UNLINKED", "Risk", data.riskId, `${link.risk.code} unlinked from control ${link.control.code}.`) });
  });
}

// ───────────── treatment actions ─────────────

export async function createTreatmentAction(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const data = treatmentActionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const risk = await tx.risk.findUnique({ where: { id: data.riskId }, select: { status: true, code: true } });
    if (!risk) throw new RiskNotFoundError();
    if (!isRiskEditable(risk.status)) throw new RiskLockedError();
    const action = await tx.riskTreatmentAction.create({
      data: { ...data, description: data.description || null, createdById: actor.id },
      select: { id: true },
    });
    await tx.auditEvent.create({ data: event(actor.id, "RISK_ACTION_CREATED", "Risk", data.riskId, `Treatment action added to ${risk.code}.`) });
    return action;
  });
}

export async function updateTreatmentActionStatus(db: PrismaClient, actor: Actor, input: unknown) {
  assertRolePermission(actor.role, "risks:manage");
  const data = actionStatusSchema.parse(input);
  return db.$transaction(async (tx) => {
    const action = await tx.riskTreatmentAction.findUnique({
      where: { id: data.actionId },
      select: { id: true, status: true, riskId: true, risk: { select: { status: true, code: true } } },
    });
    if (!action) throw new RiskNotFoundError();
    if (!isRiskEditable(action.risk.status)) throw new RiskLockedError();
    if (!canTransitionTreatmentAction(action.status, data.targetStatus)) throw new InvalidRiskTransitionError();
    const changed = await tx.riskTreatmentAction.updateMany({
      where: { id: action.id, status: action.status },
      data: { status: data.targetStatus, completedAt: data.targetStatus === "DONE" ? new Date() : null },
    });
    if (changed.count !== 1) throw new InvalidRiskTransitionError();
    await tx.auditEvent.create({
      data: event(actor.id, "RISK_ACTION_STATUS_CHANGED", "Risk", action.riskId, `${action.risk.code}: action ${action.status} -> ${data.targetStatus}.`),
    });
    return { id: action.id };
  });
}
