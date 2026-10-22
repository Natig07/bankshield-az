import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertRolePermission, type Role } from "@/lib/auth/authorization";
import { getEngagementReport } from "./data";

type Actor = { id: string; role: Role | string };

export class ReportNotFoundError extends Error {
  constructor() {
    super("The engagement was not found.");
    this.name = "ReportNotFoundError";
  }
}

// Records that a report with this exact content was generated. The record keeps only the
// fingerprint, never the report text, so it cannot leak evidence or findings.
export async function recordReportGeneration(db: PrismaClient, actor: Actor, engagementId: string, locale: "az" | "en") {
  assertRolePermission(actor.role, "reports:manage");
  const report = await getEngagementReport(db, actor, engagementId);
  if (!report) throw new ReportNotFoundError();
  return db.$transaction(async (tx) => {
    const record = await tx.reportRecord.create({
      data: { engagementId, locale, generatedById: actor.id, contentSha256: report.contentSha256 },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "REPORT_GENERATED",
        entityType: "AuditEngagement",
        entityId: engagementId,
        outcome: "SUCCESS",
        detail: `${locale} ${report.contentSha256.slice(0, 12)}`,
      },
    });
    return { id: record.id, contentSha256: report.contentSha256, generatedAt: record.generatedAt };
  });
}

export async function listReportRecords(db: PrismaClient, actor: Actor, engagementId: string) {
  const report = await getEngagementReport(db, actor, engagementId);
  if (!report) throw new ReportNotFoundError();
  const records = await db.reportRecord.findMany({
    where: { engagementId },
    orderBy: { generatedAt: "desc" },
    take: 20,
    select: { id: true, locale: true, contentSha256: true, generatedAt: true, generatedById: true },
  });
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(records.map((r) => r.generatedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  return records.map(({ generatedById, ...r }) => ({ ...r, generatedBy: users.get(generatedById) ?? "" }));
}
