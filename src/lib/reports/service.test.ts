import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { PermissionDeniedError, type Role } from "@/lib/auth/authorization";
import { getEngagementReport } from "./data";
import { listReportRecords, recordReportGeneration, ReportNotFoundError } from "./service";

let prisma: PrismaClient;
let directory: string;
const ids: Record<string, string> = {};
const who = (name: string, role: Role) => ({ id: ids[name], role });
const auditor = () => who("auditor", "AUDITOR");
const outsider = () => who("outsider", "AUDITOR");
const admin = () => who("admin", "ADMINISTRATOR");
const analyst = () => who("analyst", "SECURITY_ANALYST");
const viewer = () => who("viewer", "READ_ONLY_REVIEWER");

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "bankshield-reports-tests-"));
  const databasePath = path.join(directory, "reports.db");
  const sqlite = new Database(databasePath);
  const root = path.join(process.cwd(), "prisma", "migrations");
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    sqlite.exec(readFileSync(path.join(root, entry.name, "migration.sql"), "utf8"));
  }
  sqlite.close();
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) });
  for (const [name, role] of [
    ["admin", "ADMINISTRATOR"], ["auditor", "AUDITOR"], ["outsider", "AUDITOR"], ["analyst", "SECURITY_ANALYST"], ["viewer", "READ_ONLY_REVIEWER"],
  ] as const) {
    ids[name] = (await prisma.user.create({ data: { email: `${name}@example.test`, name, passwordHash: "test", role } })).id;
  }
});

after(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

const rand = () => Math.random().toString(36).slice(2, 9).toUpperCase();

async function fixture() {
  const engagement = await prisma.auditEngagement.create({
    data: {
      title: "Report test", auditedOrganization: "Fixture Bank", scope: "Synthetic scope.",
      periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-12-31T00:00:00.000Z"),
      status: "IN_PROGRESS", createdById: ids.auditor,
      members: { create: [{ userId: ids.auditor }, { userId: ids.analyst }] },
    },
    select: { id: true },
  });
  const document = await prisma.regulatoryDocument.create({
    data: {
      code: `RD-${rand()}`, title: "Fixture", issuer: "Test", sourceUrl: "https://authority.example.test/x", kind: "MANDATORY_LAW", language: "az",
      versions: { create: { versionLabel: "v1", sourceUrl: "https://authority.example.test/x" } },
    },
    select: { versions: { select: { id: true } } },
  });
  const requirement = await prisma.regulatoryRequirement.create({ data: { versionId: document.versions[0].id, clauseId: "4.1", topic: "Access" }, select: { id: true } });
  await prisma.auditRequirementSelection.create({
    data: { engagementId: engagement.id, requirementId: requirement.id, selectedById: ids.auditor, verificationStatusAtSelection: "PENDING_VERIFICATION", unverifiedAcknowledged: true, decisionNote: "Fictional." },
  });
  const control = await prisma.cybersecurityControl.create({ data: { code: `C-${rand()}`, title: "Access review", domain: "Access", source: "Internal" }, select: { id: true, code: true } });
  const scopeItem = await prisma.auditScopeItem.create({ data: { engagementId: engagement.id, requirementId: requirement.id, controlId: control.id }, select: { id: true } });
  return { engagementId: engagement.id, requirementId: requirement.id, controlId: control.id, controlCode: control.code, scopeItemId: scopeItem.id };
}

test("the report reflects assessments, evidence, findings and linked risks, and never claims untested items are compliant", async () => {
  const f = await fixture();
  let report = await getEngagementReport(prisma, auditor(), f.engagementId);
  assert.ok(report);
  assert.equal(report.assessments[0].status, "NOT_TESTED");
  assert.equal(report.requirements[0].verificationStatus, "PENDING_VERIFICATION");
  assert.equal(report.requirements[0].unverifiedAcknowledged, true);

  const evidence = await prisma.evidenceDocument.create({
    data: { engagementId: f.engagementId, controlId: f.controlId, originalName: "policy.pdf", storageKey: `k-${rand()}`, mimeType: "application/pdf", sizeBytes: 10, sha256: "b".repeat(64), uploadedById: ids.analyst, reviewStatus: "ACCEPTED" },
    select: { id: true },
  });
  const assessment = await prisma.controlAssessment.create({
    data: { scopeItemId: f.scopeItemId, version: 1, status: "PARTIALLY_COMPLIANT", justification: "Policy exists.", assessedById: ids.analyst, approvedById: ids.auditor, approvedAt: new Date() },
    select: { id: true },
  });
  await prisma.controlAssessmentEvidence.create({ data: { assessmentId: assessment.id, evidenceId: evidence.id, linkedById: ids.analyst } });
  const finding = await prisma.auditFinding.create({
    data: { engagementId: f.engagementId, requirementId: f.requirementId, title: "Shared accounts", description: "x", severity: "HIGH", inherentLikelihood: 4, inherentImpact: 4, residualLikelihood: 3, residualImpact: 3, createdById: ids.auditor },
    select: { id: true },
  });
  await prisma.remediationAction.create({ data: { findingId: finding.id, ownerName: "IT", actionPlan: "Named accounts", dueDate: new Date("2026-12-31T00:00:00.000Z") } });
  const risk = await prisma.risk.create({
    data: { code: `RSK-${rand()}`, title: "Misuse", description: "x", category: "ACCESS_CONTROL", ownerName: "IT", inherentLikelihood: 4, inherentImpact: 4, residualLikelihood: 3, residualImpact: 3, createdById: ids.analyst },
    select: { id: true },
  });
  await prisma.riskControl.create({ data: { riskId: risk.id, controlId: f.controlId, linkedById: ids.analyst } });
  // A risk linked only to an unrelated control must not appear.
  const otherControl = await prisma.cybersecurityControl.create({ data: { code: `C-${rand()}`, title: "Other", domain: "x", source: "Internal" }, select: { id: true } });
  const unrelated = await prisma.risk.create({
    data: { code: `RSK-${rand()}`, title: "Unrelated", description: "x", category: "OTHER", ownerName: "IT", inherentLikelihood: 1, inherentImpact: 1, createdById: ids.analyst },
    select: { id: true },
  });
  await prisma.riskControl.create({ data: { riskId: unrelated.id, controlId: otherControl.id, linkedById: ids.analyst } });

  report = await getEngagementReport(prisma, auditor(), f.engagementId);
  assert.ok(report);
  assert.equal(report.assessments[0].status, "PARTIALLY_COMPLIANT");
  assert.equal(report.assessments[0].approvedBy, "auditor");
  assert.deepEqual(report.assessments[0].evidence, [{ name: "policy.pdf", sha256: "b".repeat(64), reviewStatus: "ACCEPTED" }]);
  assert.equal(report.findings[0].score.inherent, 16);
  assert.equal(report.findings[0].score.residual, 9);
  assert.equal(report.findings[0].score.band, "MEDIUM");
  assert.equal(report.findings[0].actions[0].status, "OPEN");
  assert.deepEqual(report.risks.map((r) => r.title), ["Misuse"]);
  assert.deepEqual(report.risks[0].controlCodes, [f.controlCode]);
  assert.equal(report.evidenceSummary.total, 1);
  assert.match(report.contentSha256, /^[0-9a-f]{64}$/);
});

test("the fingerprint is stable for unchanged content and changes when a record changes", async () => {
  const f = await fixture();
  const first = await getEngagementReport(prisma, admin(), f.engagementId);
  const again = await getEngagementReport(prisma, admin(), f.engagementId);
  assert.equal(first?.contentSha256, again?.contentSha256);
  await prisma.auditFinding.create({ data: { engagementId: f.engagementId, title: "New", description: "x", severity: "LOW", createdById: ids.auditor } });
  const changed = await getEngagementReport(prisma, admin(), f.engagementId);
  assert.notEqual(first?.contentSha256, changed?.contentSha256);
});

test("only the administrator, the preparer and members can reach a report", async () => {
  const f = await fixture();
  assert.ok(await getEngagementReport(prisma, admin(), f.engagementId));
  assert.ok(await getEngagementReport(prisma, analyst(), f.engagementId));
  assert.equal(await getEngagementReport(prisma, outsider(), f.engagementId), null);
  assert.equal(await getEngagementReport(prisma, viewer(), f.engagementId), null);
  await assert.rejects(recordReportGeneration(prisma, outsider(), f.engagementId, "en"), ReportNotFoundError);
  await assert.rejects(listReportRecords(prisma, outsider(), f.engagementId), ReportNotFoundError);
});

test("recording a report needs reports:manage and stores only the fingerprint with an audit event", async () => {
  const f = await fixture();
  await assert.rejects(recordReportGeneration(prisma, analyst(), f.engagementId, "en"), PermissionDeniedError);
  await assert.rejects(recordReportGeneration(prisma, viewer(), f.engagementId, "en"), PermissionDeniedError);
  assert.equal(await prisma.reportRecord.count({ where: { engagementId: f.engagementId } }), 0);

  const result = await recordReportGeneration(prisma, auditor(), f.engagementId, "az");
  const current = await getEngagementReport(prisma, auditor(), f.engagementId);
  assert.equal(result.contentSha256, current?.contentSha256);
  const records = await listReportRecords(prisma, auditor(), f.engagementId);
  assert.equal(records.length, 1);
  assert.equal(records[0].locale, "az");
  assert.equal(records[0].generatedBy, "auditor");
  assert.equal(records[0].contentSha256, result.contentSha256);
  const events = await prisma.auditEvent.findMany({ where: { action: "REPORT_GENERATED", entityId: f.engagementId } });
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "SUCCESS");
  assert.ok(!events[0].detail?.includes(result.contentSha256), "the audit event keeps only a short prefix");
});
