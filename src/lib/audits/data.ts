import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth/service";
import { ENGAGEMENT_STATUSES } from "./workflow";

export type EngagementFilters = { search: string; status: string };

export function normalizeEngagementFilters(input: {
  search?: string;
  status?: string;
}): EngagementFilters {
  return {
    search: (input.search ?? "").trim().slice(0, 120),
    status: ENGAGEMENT_STATUSES.includes(input.status as (typeof ENGAGEMENT_STATUSES)[number])
      ? input.status!
      : "ALL",
  };
}

export async function getEngagementList(
  db: PrismaClient,
  user: Pick<AuthUser, "id" | "role">,
  filters: EngagementFilters,
) {
  return db.auditEngagement.findMany({
    where: {
      AND: [
        user.role === "ADMINISTRATOR"
          ? {}
          : {
              OR: [
                { createdById: user.id },
                { members: { some: { userId: user.id } } },
              ],
            },
        filters.status === "ALL" ? {} : { status: filters.status },
        filters.search
          ? {
              OR: [
                { title: { contains: filters.search } },
                { auditedOrganization: { contains: filters.search } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      auditedOrganization: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      updatedAt: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
}

export async function getEngagementDetails(
  db: PrismaClient,
  user: Pick<AuthUser, "id" | "role">,
  engagementId: string,
) {
  const engagement = await db.auditEngagement.findFirst({
    where: {
      id: engagementId,
      ...(user.role === "ADMINISTRATOR"
        ? {}
        : {
            OR: [
              { createdById: user.id },
              { members: { some: { userId: user.id } } },
            ],
          }),
    },
    select: {
      id: true,
      title: true,
      auditedOrganization: true,
      scope: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
      createdBy: { select: { name: true, email: true } },
      members: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, isActive: true } },
        },
      },
      requirementSelections: {
        orderBy: { selectedAt: "desc" },
        select: {
          id: true,
          selectedAt: true,
          verificationStatusAtSelection: true,
          unverifiedAcknowledged: true,
          decisionNote: true,
          selectedBy: { select: { name: true } },
          requirement: {
            select: {
              id: true,
              clauseId: true,
              topic: true,
              verificationStatus: true,
              version: {
                select: {
                  versionLabel: true,
                  document: { select: { code: true, title: true, issuer: true, sourceUrl: true } },
                },
              },
              scopeItems: {
                where: { engagementId },
                select: {
                  assessments: {
                    where: { isCurrent: true },
                    select: { status: true },
                  },
                },
              },
            },
          },
        },
      },
      scopeItems: {
        select: {
          assessments: {
            where: { isCurrent: true },
            select: { status: true },
          },
        },
      },
      findings: { select: { id: true, severity: true, status: true } },
      _count: { select: { evidence: true } },
    },
  });
  if (!engagement) return null;
  const auditEvents = await db.auditEvent.findMany({
    where: { entityType: "AuditEngagement", entityId: engagementId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      detail: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
  return { ...engagement, auditEvents };
}

export async function getSelectableRequirements(db: PrismaClient, engagementId: string) {
  return db.regulatoryRequirement.findMany({
    where: {
      isDemo: false,
      scopeSelections: { none: { engagementId } },
    },
    orderBy: [
      { version: { document: { code: "asc" } } },
      { clauseId: "asc" },
    ],
    select: {
      id: true,
      clauseId: true,
      topic: true,
      verificationStatus: true,
      version: {
        select: {
          versionLabel: true,
          document: { select: { code: true, title: true, issuer: true } },
        },
      },
    },
  });
}

export function logEngagementQueryFailure(error: unknown, operation: string): void {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : undefined;
  console.error("Audit engagement database query failed.", { operation, errorName, errorCode });
}
