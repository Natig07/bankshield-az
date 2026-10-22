import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth/service";
import { canAccessEngagement } from "@/lib/auth/resource-access";

export const SUGGESTION_FILTERS = ["PENDING_REVIEW", "ACCEPTED", "REJECTED", "ALL"] as const;
export type SuggestionFilter = (typeof SUGGESTION_FILTERS)[number];

export function normalizeFilter(value: string | string[] | undefined): SuggestionFilter {
  const single = Array.isArray(value) ? value[0] : value;
  return (SUGGESTION_FILTERS as readonly string[]).includes(single ?? "") ? (single as SuggestionFilter) : "ALL";
}

function stringList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function getAiReviewData(
  db: PrismaClient,
  user: Pick<AuthUser, "id" | "role">,
  engagementId: string | null,
  filter: SuggestionFilter,
) {
  const engagements = await db.auditEngagement.findMany({
    where:
      user.role === "ADMINISTRATOR"
        ? {}
        : { OR: [{ createdById: user.id }, { members: { some: { userId: user.id } } }] },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, title: true, auditedOrganization: true, status: true },
  });
  const selected =
    engagementId && engagements.some((item) => item.id === engagementId) && (await canAccessEngagement(db, user, engagementId))
      ? engagementId
      : null;
  if (!selected) return { engagements, selectedId: null, suggestions: [], counts: { PENDING_REVIEW: 0, ACCEPTED: 0, REJECTED: 0 }, lastRun: null };

  const [rows, grouped, lastRun] = await Promise.all([
    db.aiReviewSuggestion.findMany({
      where: { engagementId: selected, ...(filter === "ALL" ? {} : { reviewStatus: filter }) },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
      include: {
        requirement: { select: { clauseId: true, verificationStatus: true, isDemo: true } },
        reviewedBy: { select: { name: true } },
        run: { select: { model: true, createdAt: true } },
      },
    }),
    db.aiReviewSuggestion.groupBy({ by: ["reviewStatus"], where: { engagementId: selected }, _count: { _all: true } }),
    db.aiReviewRun.findFirst({
      where: { engagementId: selected },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { status: true, errorCode: true, model: true, createdAt: true, suggestionCount: true },
    }),
  ]);

  const idsOf = (type: string) => rows.filter((row) => row.targetType === type).map((row) => row.targetId);
  const [scopeItems, findings, risks] = await Promise.all([
    db.auditScopeItem.findMany({
      where: { id: { in: idsOf("SCOPE_ITEM") } },
      select: { id: true, control: { select: { code: true, title: true } }, requirement: { select: { clauseId: true } } },
    }),
    db.auditFinding.findMany({ where: { id: { in: idsOf("FINDING") } }, select: { id: true, title: true, severity: true, status: true } }),
    db.risk.findMany({ where: { id: { in: idsOf("RISK") } }, select: { id: true, code: true, title: true } }),
  ]);
  const labels = new Map<string, string>();
  for (const item of scopeItems) labels.set(`SCOPE_ITEM:${item.id}`, `${item.control.code} — ${item.control.title} (${item.requirement.clauseId})`);
  for (const item of findings) labels.set(`FINDING:${item.id}`, `${item.title} [${item.severity}/${item.status}]`);
  for (const item of risks) labels.set(`RISK:${item.id}`, `${item.code} — ${item.title}`);

  const counts = { PENDING_REVIEW: 0, ACCEPTED: 0, REJECTED: 0 };
  for (const group of grouped) if (group.reviewStatus in counts) counts[group.reviewStatus as keyof typeof counts] = group._count._all;

  return {
    engagements,
    selectedId: selected,
    counts,
    lastRun,
    suggestions: [...rows].sort((a, b) => Number(b.reviewStatus === "PENDING_REVIEW") - Number(a.reviewStatus === "PENDING_REVIEW")).map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetLabel: labels.get(`${row.targetType}:${row.targetId}`) ?? null,
      requirementClause: row.requirement?.clauseId ?? null,
      requirementUnverified: row.requirement ? row.requirement.verificationStatus !== "VERIFIED" || row.requirement.isDemo : false,
      kind: row.kind,
      title: row.title,
      reasoning: row.reasoning,
      recommendedActions: stringList(row.recommendedActions),
      verificationSteps: stringList(row.verificationSteps),
      confidence: row.confidence,
      limitations: row.limitations,
      reviewStatus: row.reviewStatus,
      reviewedByName: row.reviewedBy?.name ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      model: row.run.model,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
