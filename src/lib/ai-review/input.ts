import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";

export const LIMITS = { scopeItems: 40, findings: 40, risks: 40, text: 1_200, short: 300 } as const;

export type RefTarget = { type: "SCOPE_ITEM" | "FINDING" | "RISK"; id: string; requirementId: string | null };

export type ReviewInput = {
  payload: unknown;
  refs: Map<string, RefTarget>;
  summary: {
    scopeItems: number;
    findings: number;
    risks: number;
    truncated: boolean;
  };
};

// Control characters can hide instructions or break JSON transport; normalise and bound every string.
export function clip(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

export async function collectReviewInput(db: PrismaClient, engagementId: string): Promise<ReviewInput | null> {
  const engagement = await db.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, status: true, periodStart: true, periodEnd: true },
  });
  if (!engagement) return null;

  const [scopeRows, findingRows] = await Promise.all([
    db.auditScopeItem.findMany({
      where: { engagementId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: LIMITS.scopeItems + 1,
      select: {
        id: true,
        requirementId: true,
        controlId: true,
        requirement: {
          select: {
            clauseId: true,
            section: true,
            topic: true,
            textOriginal: true,
            textTranslation: true,
            requirementType: true,
            verificationStatus: true,
            isDemo: true,
          },
        },
        control: { select: { code: true, title: true, description: true } },
        assessments: {
          where: { isCurrent: true },
          take: 1,
          select: {
            status: true,
            notApplicableReason: true,
            justification: true,
            approvedAt: true,
            evidenceLinks: { select: { evidence: { select: { reviewStatus: true } } } },
          },
        },
      },
    }),
    db.auditFinding.findMany({
      where: { engagementId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: LIMITS.findings + 1,
      select: {
        id: true,
        requirementId: true,
        title: true,
        description: true,
        severity: true,
        status: true,
        requirement: { select: { clauseId: true } },
        actions: { select: { status: true, actionPlan: true, dueDate: true } },
      },
    }),
  ]);

  const scopeTruncated = scopeRows.length > LIMITS.scopeItems;
  const findingsTruncated = findingRows.length > LIMITS.findings;
  const scope = scopeRows.slice(0, LIMITS.scopeItems);
  const findings = findingRows.slice(0, LIMITS.findings);

  const controlIds = [...new Set(scope.map((item) => item.controlId))];
  const riskRows = controlIds.length
    ? await db.risk.findMany({
        where: { controls: { some: { controlId: { in: controlIds } } } },
        orderBy: [{ code: "asc" }],
        take: LIMITS.risks + 1,
        select: {
          id: true,
          code: true,
          title: true,
          description: true,
          category: true,
          status: true,
          treatment: true,
          inherentLikelihood: true,
          inherentImpact: true,
          residualLikelihood: true,
          residualImpact: true,
          controls: { select: { controlId: true } },
        },
      })
    : [];
  const risksTruncated = riskRows.length > LIMITS.risks;
  const risks = riskRows.slice(0, LIMITS.risks);

  const refs = new Map<string, RefTarget>();
  const scopeRefByControl = new Map<string, string[]>();
  const scopeRefByRequirement = new Map<string, string[]>();
  const now = Date.now();

  const scopePayload = scope.map((item, index) => {
    const ref = `S${index + 1}`;
    refs.set(ref, { type: "SCOPE_ITEM", id: item.id, requirementId: item.requirementId });
    scopeRefByControl.set(item.controlId, [...(scopeRefByControl.get(item.controlId) ?? []), ref]);
    scopeRefByRequirement.set(item.requirementId, [...(scopeRefByRequirement.get(item.requirementId) ?? []), ref]);
    const assessment = item.assessments[0];
    const evidence = { linked: 0, accepted: 0, pendingReview: 0, rejectedOrSuperseded: 0 };
    for (const link of assessment?.evidenceLinks ?? []) {
      evidence.linked += 1;
      const status = link.evidence.reviewStatus;
      if (status === "ACCEPTED") evidence.accepted += 1;
      else if (status === "PENDING_REVIEW") evidence.pendingReview += 1;
      else evidence.rejectedOrSuperseded += 1;
    }
    return {
      ref,
      requirement: {
        clauseId: item.requirement.clauseId,
        section: clip(item.requirement.section, LIMITS.short),
        topic: clip(item.requirement.topic, LIMITS.short),
        originalText: clip(item.requirement.textOriginal, LIMITS.text),
        translatedText: clip(item.requirement.textTranslation, LIMITS.text),
        type: item.requirement.requirementType,
        verificationStatus: item.requirement.verificationStatus,
        isFictionalDemo: item.requirement.isDemo,
      },
      control: {
        code: item.control.code,
        title: clip(item.control.title, LIMITS.short),
        description: clip(item.control.description, LIMITS.text),
      },
      currentAssessment: assessment
        ? {
            status: assessment.status,
            notApplicableReason: clip(assessment.notApplicableReason, LIMITS.short),
            assessorJustification: clip(assessment.justification, LIMITS.text),
            formallyApproved: Boolean(assessment.approvedAt),
            evidenceMetadata: evidence,
          }
        : null,
    };
  });

  const findingsPayload = findings.map((finding, index) => {
    const ref = `F${index + 1}`;
    refs.set(ref, { type: "FINDING", id: finding.id, requirementId: finding.requirementId });
    return {
      ref,
      requirementClauseId: finding.requirement?.clauseId ?? null,
      relatedScopeRefs: finding.requirementId ? (scopeRefByRequirement.get(finding.requirementId) ?? []) : [],
      title: clip(finding.title, LIMITS.short),
      description: clip(finding.description, LIMITS.text),
      severityAssignedByHuman: finding.severity,
      status: finding.status,
      remediationActions: finding.actions.slice(0, 10).map((action) => ({
        status: action.status,
        plan: clip(action.actionPlan, LIMITS.short),
        overdue: action.status !== "VERIFIED" && action.status !== "COMPLETED" && action.dueDate.getTime() < now,
      })),
    };
  });

  const risksPayload = risks.map((risk, index) => {
    const ref = `R${index + 1}`;
    refs.set(ref, { type: "RISK", id: risk.id, requirementId: null });
    const inherent = risk.inherentLikelihood * risk.inherentImpact;
    const residual =
      risk.residualLikelihood != null && risk.residualImpact != null
        ? risk.residualLikelihood * risk.residualImpact
        : null;
    return {
      ref,
      code: risk.code,
      title: clip(risk.title, LIMITS.short),
      description: clip(risk.description, LIMITS.text),
      category: risk.category,
      status: risk.status,
      treatment: risk.treatment,
      inherentScore: inherent,
      residualScore: residual,
      relatedScopeRefs: [...new Set(risk.controls.flatMap((link) => scopeRefByControl.get(link.controlId) ?? []))],
    };
  });

  return {
    payload: {
      engagement: {
        status: engagement.status,
        periodStart: engagement.periodStart.toISOString().slice(0, 10),
        periodEnd: engagement.periodEnd.toISOString().slice(0, 10),
      },
      scopeItems: scopePayload,
      findings: findingsPayload,
      risks: risksPayload,
    },
    refs,
    summary: {
      scopeItems: scopePayload.length,
      findings: findingsPayload.length,
      risks: risksPayload.length,
      truncated: scopeTruncated || findingsTruncated || risksTruncated,
    },
  };
}
