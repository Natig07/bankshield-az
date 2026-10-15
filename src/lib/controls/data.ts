import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth/service";

export function normalizeControlSearch(search: string | null | undefined): string {
  return (search ?? "").trim().slice(0, 120);
}

export async function getControlCatalogue(db: PrismaClient, search: string) {
  return db.cybersecurityControl.findMany({
    where: {
      isDemo: false,
      ...(search
        ? {
          OR: [
            { code: { contains: search } },
            { title: { contains: search } },
            { description: { contains: search } },
            { domain: { contains: search } },
          ],
        }
        : {}),
    },
    orderBy: [{ code: "asc" }, { id: "asc" }],
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      domain: true,
      source: true,
      mappings: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          rationale: true,
          createdAt: true,
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
            },
          },
        },
      },
    },
  });
}

export async function getRequirementsForMapping(db: PrismaClient) {
  return db.regulatoryRequirement.findMany({
    where: { isDemo: false },
    orderBy: [{ version: { document: { code: "asc" } } }, { clauseId: "asc" }],
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

export async function getEngagementAssessments(
  db: PrismaClient,
  user: Pick<AuthUser, "id" | "role">,
  engagementId: string,
) {
  return db.auditEngagement.findFirst({
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
      evidence: {
        orderBy: [{ uploadedAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          controlId: true,
          originalName: true,
          reviewStatus: true,
          uploadedAt: true,
        },
      },
      scopeItems: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          control: { select: { id: true, code: true, title: true, domain: true } },
          requirement: {
            select: {
              id: true,
              clauseId: true,
              topic: true,
              verificationStatus: true,
              version: {
                select: {
                  document: { select: { code: true, title: true } },
                },
              },
            },
          },
          assessments: {
            orderBy: [{ version: "desc" }, { id: "asc" }],
            select: {
              id: true,
              version: true,
              isCurrent: true,
              status: true,
              notApplicableReason: true,
              justification: true,
              assessedById: true,
              approvedById: true,
              approvedAt: true,
              createdAt: true,
              evidenceLinks: {
                orderBy: [{ linkedAt: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  linkedAt: true,
                  evidence: { select: { id: true, originalName: true, reviewStatus: true } },
                  linkedBy: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

export function logControlsQueryFailure(error: unknown, operation: string): void {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : undefined;
  console.error("Controls database query failed.", { operation, errorName, errorCode });
}
