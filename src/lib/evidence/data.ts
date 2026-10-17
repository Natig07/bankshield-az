import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth/service";

export async function getEvidenceList(
  db: PrismaClient,
  user: Pick<AuthUser, "id" | "role">,
  engagementId?: string,
) {
  return db.evidenceDocument.findMany({
    where: {
      ...(engagementId ? { engagementId } : {}),
      engagement:
        user.role === "ADMINISTRATOR"
          ? {}
          : { OR: [{ createdById: user.id }, { members: { some: { userId: user.id } } }] },
    },
    orderBy: [{ uploadedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      engagementId: true,
      controlId: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      uploadedAt: true,
      reviewStatus: true,
      reviewNote: true,
      uploadedById: true,
      replacesId: true,
      engagement: { select: { title: true, status: true } },
      control: { select: { code: true, title: true } },
    },
  });
}

// Engagements a user may upload to, with the controls in each scope.
export async function getUploadTargets(db: PrismaClient, user: Pick<AuthUser, "id" | "role">) {
  return db.auditEngagement.findMany({
    where: {
      status: { in: ["DRAFT", "IN_PROGRESS"] },
      ...(user.role === "ADMINISTRATOR"
        ? {}
        : { OR: [{ createdById: user.id }, { members: { some: { userId: user.id } } }] }),
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      scopeItems: {
        select: { control: { select: { id: true, code: true, title: true } } },
      },
    },
  });
}
