import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/lib/auth/authorization";
import { riskBand, riskScore } from "@/lib/domain/risk";

type Actor = { id: string; role: Role | string };

export type ReportScoreSummary = { inherent: number | null; residual: number | null; band: string | null };

export type EngagementReport = {
  engagement: {
    id: string;
    title: string;
    auditedOrganization: string;
    scope: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    preparedBy: string;
    approvedBy: string | null;
    approvedAt: string | null;
  };
  requirements: {
    clauseId: string;
    topic: string | null;
    source: string;
    versionLabel: string;
    verificationStatus: string;
    unverifiedAcknowledged: boolean;
    decisionNote: string | null;
  }[];
  assessments: {
    controlCode: string;
    controlTitle: string;
    clauseId: string;
    status: string;
    version: number | null;
    justification: string | null;
    notApplicableReason: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    evidence: { name: string; sha256: string; reviewStatus: string }[];
  }[];
  findings: {
    title: string;
    severity: string;
    status: string;
    clauseId: string | null;
    score: ReportScoreSummary;
    actions: { plan: string; owner: string; dueDate: string; status: string }[];
  }[];
  risks: {
    code: string;
    title: string;
    status: string;
    revision: number;
    controlCodes: string[];
    score: ReportScoreSummary;
  }[];
  evidenceSummary: { total: number; byReviewStatus: Record<string, number> };
  // Deterministic fingerprint of everything above, so a later copy can be compared with it.
  contentSha256: string;
};

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const day = (value: Date) => value.toISOString().slice(0, 10);

function scores(
  inherentLikelihood: number | null,
  inherentImpact: number | null,
  residualLikelihood: number | null,
  residualImpact: number | null,
): ReportScoreSummary {
  const inherent = inherentLikelihood != null && inherentImpact != null ? riskScore(inherentLikelihood, inherentImpact) : null;
  const residual = residualLikelihood != null && residualImpact != null ? riskScore(residualLikelihood, residualImpact) : null;
  const basis = residual ?? inherent;
  return { inherent, residual, band: basis == null ? null : riskBand(basis) };
}

// Only the administrator, the preparer and engagement members reach an engagement; a miss returns
// null so the existence of other engagements is not disclosed.
export async function getEngagementReport(db: PrismaClient, actor: Actor, engagementId: string): Promise<EngagementReport | null> {
  const engagement = await db.auditEngagement.findFirst({
    where: {
      id: engagementId,
      ...(actor.role === "ADMINISTRATOR" ? {} : { OR: [{ createdById: actor.id }, { members: { some: { userId: actor.id } } }] }),
    },
    select: {
      id: true,
      title: true,
      auditedOrganization: true,
      scope: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      approvedById: true,
      approvedAt: true,
      createdBy: { select: { name: true } },
      requirementSelections: {
        orderBy: { requirement: { clauseId: "asc" } },
        select: {
          unverifiedAcknowledged: true,
          decisionNote: true,
          requirement: {
            select: {
              clauseId: true,
              topic: true,
              verificationStatus: true,
              version: { select: { versionLabel: true, document: { select: { code: true } } } },
            },
          },
        },
      },
      scopeItems: {
        orderBy: [{ control: { code: "asc" } }, { id: "asc" }],
        select: {
          control: { select: { id: true, code: true, title: true } },
          requirement: { select: { clauseId: true } },
          assessments: {
            where: { isCurrent: true },
            select: {
              version: true,
              status: true,
              justification: true,
              notApplicableReason: true,
              approvedById: true,
              approvedAt: true,
              evidenceLinks: {
                orderBy: { linkedAt: "asc" },
                select: { evidence: { select: { originalName: true, sha256: true, reviewStatus: true } } },
              },
            },
          },
        },
      },
      findings: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          title: true,
          severity: true,
          status: true,
          inherentLikelihood: true,
          inherentImpact: true,
          residualLikelihood: true,
          residualImpact: true,
          requirement: { select: { clauseId: true } },
          actions: { orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: { actionPlan: true, ownerName: true, dueDate: true, status: true } },
        },
      },
      evidence: { select: { reviewStatus: true } },
    },
  });
  if (!engagement) return null;

  const approver = engagement.approvedById
    ? await db.user.findUnique({ where: { id: engagement.approvedById }, select: { name: true } })
    : null;
  const assessmentApproverIds = [
    ...new Set(engagement.scopeItems.flatMap((item) => item.assessments.map((a) => a.approvedById)).filter((id): id is string => !!id)),
  ];
  const approverNames = new Map(
    (await db.user.findMany({ where: { id: { in: assessmentApproverIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  const controlIds = engagement.scopeItems.map((item) => item.control.id);
  const risks = await db.risk.findMany({
    where: { controls: { some: { controlId: { in: controlIds } } } },
    orderBy: { code: "asc" },
    select: {
      code: true,
      title: true,
      status: true,
      revision: true,
      inherentLikelihood: true,
      inherentImpact: true,
      residualLikelihood: true,
      residualImpact: true,
      controls: { select: { control: { select: { id: true, code: true } } } },
    },
  });

  const byReviewStatus: Record<string, number> = {};
  for (const record of engagement.evidence) byReviewStatus[record.reviewStatus] = (byReviewStatus[record.reviewStatus] ?? 0) + 1;

  const report: Omit<EngagementReport, "contentSha256"> = {
    engagement: {
      id: engagement.id,
      title: engagement.title,
      auditedOrganization: engagement.auditedOrganization,
      scope: engagement.scope,
      periodStart: day(engagement.periodStart),
      periodEnd: day(engagement.periodEnd),
      status: engagement.status,
      preparedBy: engagement.createdBy.name,
      approvedBy: approver?.name ?? null,
      approvedAt: iso(engagement.approvedAt),
    },
    requirements: engagement.requirementSelections.map((selection) => ({
      clauseId: selection.requirement.clauseId,
      topic: selection.requirement.topic,
      source: selection.requirement.version.document.code,
      versionLabel: selection.requirement.version.versionLabel,
      verificationStatus: selection.requirement.verificationStatus,
      unverifiedAcknowledged: selection.unverifiedAcknowledged,
      decisionNote: selection.decisionNote,
    })),
    assessments: engagement.scopeItems.map((item) => {
      const current = item.assessments[0];
      return {
        controlCode: item.control.code,
        controlTitle: item.control.title,
        clauseId: item.requirement.clauseId,
        status: current?.status ?? "NOT_TESTED",
        version: current?.version ?? null,
        justification: current?.justification ?? null,
        notApplicableReason: current?.notApplicableReason ?? null,
        approvedBy: current?.approvedById ? (approverNames.get(current.approvedById) ?? null) : null,
        approvedAt: iso(current?.approvedAt),
        evidence: (current?.evidenceLinks ?? []).map(({ evidence }) => ({
          name: evidence.originalName,
          sha256: evidence.sha256,
          reviewStatus: evidence.reviewStatus,
        })),
      };
    }),
    findings: engagement.findings.map((finding) => ({
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      clauseId: finding.requirement?.clauseId ?? null,
      score: scores(finding.inherentLikelihood, finding.inherentImpact, finding.residualLikelihood, finding.residualImpact),
      actions: finding.actions.map((action) => ({
        plan: action.actionPlan,
        owner: action.ownerName,
        dueDate: day(action.dueDate),
        status: action.status,
      })),
    })),
    risks: risks.map((risk) => ({
      code: risk.code,
      title: risk.title,
      status: risk.status,
      revision: risk.revision,
      controlCodes: risk.controls.filter(({ control }) => controlIds.includes(control.id)).map(({ control }) => control.code).sort(),
      score: scores(risk.inherentLikelihood, risk.inherentImpact, risk.residualLikelihood, risk.residualImpact),
    })),
    evidenceSummary: { total: engagement.evidence.length, byReviewStatus },
  };
  const contentSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  return { ...report, contentSha256 };
}
