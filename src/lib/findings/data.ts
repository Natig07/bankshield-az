import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth/service";
import { FINDING_STATUSES, SEVERITIES } from "@/lib/domain/enums";
import { riskBand, riskScore } from "@/lib/domain/risk";
import { isRemediationOverdue } from "./workflow";

type User = Pick<AuthUser, "id" | "role">;
type RawParam = string | string[] | undefined;
export type FindingFilters = { search: string; status: string; severity: string };

const first = (value: RawParam) => ((Array.isArray(value) ? value[0] : value) ?? "").trim();

export function normalizeFindingFilters(input: { q?: RawParam; status?: RawParam; severity?: RawParam }): FindingFilters {
  const status = first(input.status);
  const severity = first(input.severity);
  return {
    search: first(input.q).slice(0, 120),
    status: (FINDING_STATUSES as readonly string[]).includes(status) ? status : "ALL",
    severity: (SEVERITIES as readonly string[]).includes(severity) ? severity : "ALL",
  };
}

// Same visibility rule as engagements: administrators see everything, other roles only
// engagements they created or belong to.
function engagementScope(user: User) {
  return user.role === "ADMINISTRATOR"
    ? {}
    : { engagement: { OR: [{ createdById: user.id }, { members: { some: { userId: user.id } } }] } };
}

export function scoreFinding(finding: {
  inherentLikelihood: number | null;
  inherentImpact: number | null;
  residualLikelihood: number | null;
  residualImpact: number | null;
}) {
  const inherent = finding.inherentLikelihood !== null && finding.inherentImpact !== null ? riskScore(finding.inherentLikelihood, finding.inherentImpact) : null;
  const residual = finding.residualLikelihood !== null && finding.residualImpact !== null ? riskScore(finding.residualLikelihood, finding.residualImpact) : null;
  return {
    inherentScore: inherent,
    inherentBand: inherent === null ? null : riskBand(inherent),
    residualScore: residual,
    residualBand: residual === null ? null : riskBand(residual),
  };
}

export async function getFindingList(db: PrismaClient, user: User, filters: FindingFilters, now = new Date()) {
  const rows = await db.auditFinding.findMany({
    where: {
      AND: [
        engagementScope(user),
        filters.status === "ALL" ? {} : { status: filters.status },
        filters.severity === "ALL" ? {} : { severity: filters.severity },
        filters.search ? { OR: [{ title: { contains: filters.search } }, { description: { contains: filters.search } }] } : {},
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      severity: true,
      status: true,
      updatedAt: true,
      engagement: { select: { id: true, title: true } },
      requirement: { select: { clauseId: true } },
      actions: { select: { status: true, dueDate: true } },
    },
  });
  return rows.map(({ actions, ...row }) => ({
    ...row,
    totalActions: actions.length,
    openActions: actions.filter(({ status }) => status !== "VERIFIED").length,
    overdueActions: actions.filter((action) => isRemediationOverdue(action, now)).length,
  }));
}

export function summarizeFindings(list: { status: string; severity: string; overdueActions: number }[]) {
  const severities: Record<string, number> = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  let open = 0;
  let overdue = 0;
  for (const finding of list) {
    if (finding.status === "CLOSED") continue;
    open += 1;
    severities[finding.severity] = (severities[finding.severity] ?? 0) + 1;
    overdue += finding.overdueActions;
  }
  return { open, severities, overdueActions: overdue };
}

export async function getFindingDetails(db: PrismaClient, user: User, findingId: string, now = new Date()) {
  const finding = await db.auditFinding.findFirst({
    where: { id: findingId, ...engagementScope(user) },
    select: {
      id: true,
      engagementId: true,
      title: true,
      description: true,
      severity: true,
      status: true,
      requirementId: true,
      inherentLikelihood: true,
      inherentImpact: true,
      residualLikelihood: true,
      residualImpact: true,
      createdById: true,
      approvedAt: true,
      createdAt: true,
      updatedAt: true,
      engagement: { select: { id: true, title: true, status: true } },
      requirement: { select: { clauseId: true, topic: true } },
      actions: {
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        select: { id: true, ownerName: true, actionPlan: true, dueDate: true, status: true, completedAt: true, completionEvidenceId: true },
      },
      history: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, changeNote: true, createdAt: true },
      },
    },
  });
  if (!finding) return null;
  const evidence = await db.evidenceDocument.findMany({
    where: { engagementId: finding.engagementId, reviewStatus: { notIn: ["REJECTED", "SUPERSEDED"] } },
    orderBy: [{ uploadedAt: "desc" }, { id: "asc" }],
    select: { id: true, originalName: true },
  });
  const scopeRequirements = await db.auditRequirementSelection.findMany({
    where: { engagementId: finding.engagementId },
    select: { requirement: { select: { id: true, clauseId: true, topic: true } } },
  });
  return {
    ...finding,
    ...scoreFinding(finding),
    actions: finding.actions.map((action) => ({ ...action, overdue: isRemediationOverdue(action, now) })),
    evidence,
    requirements: scopeRequirements.map(({ requirement }) => requirement),
  };
}

// Engagements a finding can be raised in: the user's own, and only while findings are open for change.
export async function getFindingEngagements(db: PrismaClient, user: User) {
  return db.auditEngagement.findMany({
    where: {
      status: { in: ["IN_PROGRESS", "IN_REVIEW"] },
      ...(user.role === "ADMINISTRATOR" ? {} : { OR: [{ createdById: user.id }, { members: { some: { userId: user.id } } }] }),
    },
    orderBy: [{ title: "asc" }],
    select: {
      id: true,
      title: true,
      // Requirements already selected for the engagement: the only ones a finding may reference.
      requirementSelections: {
        orderBy: { requirement: { clauseId: "asc" } },
        select: { requirement: { select: { id: true, clauseId: true, topic: true } } },
      },
    },
  }).then((rows) =>
    rows.map(({ requirementSelections, ...engagement }) => ({
      ...engagement,
      requirements: requirementSelections.map(({ requirement }) => requirement),
    })),
  );
}
