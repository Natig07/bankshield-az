import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth/service";
import { verificationStatusSchema } from "@/lib/domain/enums";
import type { VerificationStatus } from "@/lib/domain/enums";

export type DashboardSource = {
  code: string;
  title: string;
  issuer: string;
  url: string;
  language: string;
  status: VerificationStatus;
};

export type DashboardData = {
  sources: DashboardSource[];
  sourceCount: number;
  sourcesPending: number;
  verifiedRequirements: number;
  engagementCount: number;
  assessmentCounts: Record<string, number>;
  untestedAssessments: number;
  openFindingCounts: Record<string, number>;
  evidenceCount: number;
  overdueActions: number;
  pendingSuggestions: number;
};

export type DashboardState =
  | { status: "ready"; data: DashboardData }
  | { status: "error" };

function asVerificationStatus(status: string | undefined): VerificationStatus {
  return verificationStatusSchema.parse(status ?? "PENDING_VERIFICATION");
}

export async function getDashboardData(
  db: PrismaClient,
  user: AuthUser,
  now = new Date(),
): Promise<DashboardData> {
  const engagements = await db.auditEngagement.findMany({
    where:
      user.role === "ADMINISTRATOR"
        ? undefined
        : {
            OR: [
              { createdById: user.id },
              { members: { some: { userId: user.id } } },
            ],
          },
    select: { id: true },
  });
  const engagementIds = engagements.map(({ id }) => id);

  const [documents, verifiedRequirements, assessments, findings, evidenceCount, overdueActions, pendingSuggestions] =
    await Promise.all([
      db.regulatoryDocument.findMany({
        orderBy: { code: "asc" },
        select: {
          code: true,
          title: true,
          issuer: true,
          sourceUrl: true,
          language: true,
          versions: {
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: 1,
            select: { sourceUrl: true, verificationStatus: true },
          },
        },
      }),
      db.regulatoryRequirement.count({
        where: { verificationStatus: "VERIFIED", isDemo: false },
      }),
      engagementIds.length === 0
        ? Promise.resolve([])
        : db.controlAssessment.groupBy({
            by: ["status"],
            where: { isCurrent: true, scopeItem: { engagementId: { in: engagementIds } } },
            _count: { _all: true },
          }),
      engagementIds.length === 0
        ? Promise.resolve([])
        : db.auditFinding.groupBy({
            by: ["severity"],
            where: {
              engagementId: { in: engagementIds },
              status: { not: "CLOSED" },
            },
            _count: { _all: true },
          }),
      engagementIds.length === 0
        ? Promise.resolve(0)
        : db.evidenceDocument.count({ where: { engagementId: { in: engagementIds } } }),
      engagementIds.length === 0
        ? Promise.resolve(0)
        : db.remediationAction.count({
            where: {
              dueDate: { lt: now },
              status: { notIn: ["COMPLETED", "VERIFIED"] },
              finding: { engagementId: { in: engagementIds } },
            },
          }),
      engagementIds.length === 0
        ? Promise.resolve(0)
        : db.aISuggestion.count({
            where: {
              reviewStatus: "PENDING_REVIEW",
              run: { engagementId: { in: engagementIds } },
            },
          }),
    ]);

  const sources = documents.map((document) => ({
    code: document.code,
    title: document.title,
    issuer: document.issuer,
    url: document.versions[0]?.sourceUrl ?? document.sourceUrl,
    language: document.language,
    status: asVerificationStatus(document.versions[0]?.verificationStatus),
  }));

  const assessmentCounts: Record<string, number> = {};
  for (const row of assessments) {
    assessmentCounts[row.status] = row._count._all;
  }

  const openFindingCounts: Record<string, number> = {};
  for (const row of findings) {
    openFindingCounts[row.severity] = row._count._all;
  }

  return {
    sources,
    sourceCount: sources.length,
    sourcesPending: sources.filter((source) => source.status !== "VERIFIED").length,
    verifiedRequirements,
    engagementCount: engagements.length,
    assessmentCounts,
    untestedAssessments: assessmentCounts.NOT_TESTED ?? 0,
    openFindingCounts,
    evidenceCount,
    overdueActions,
    pendingSuggestions,
  };
}

export async function getDashboardState(
  query: () => Promise<DashboardData>,
): Promise<DashboardState> {
  try {
    return { status: "ready", data: await query() };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : undefined;
    console.error("Dashboard database query failed.", { errorName, errorCode });
    return { status: "error" };
  }
}
