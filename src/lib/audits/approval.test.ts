import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import {
  ApprovedAssessmentRequiredError,
  createEngagement,
  IndependentApproverRequiredError,
  InvalidEngagementTransitionError,
  transitionEngagement,
} from "./service";
import { approveAssessment, createAssessmentRevision } from "@/lib/controls/service";
import { hasPermission } from "@/lib/auth/authorization";
import type { Role } from "@/lib/auth/authorization";

let prisma: PrismaClient;
let testDirectory: string;
let auditorId: string;
let secondAuditorId: string;
let administratorId: string;

before(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "bankshield-approval-tests-"));
  const databasePath = join(testDirectory, "approval-tests.db");
  const sqlite = new Database(databasePath);
  const migrationRoot = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationRoot, entry.name, "migration.sql"))
    .sort();
  for (const migrationPath of migrations) sqlite.exec(readFileSync(migrationPath, "utf8"));
  sqlite.close();
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) });

  const users = await Promise.all([
    prisma.user.create({ data: { email: "auditor-one@example.test", name: "Auditor One", passwordHash: "test-hash", role: "AUDITOR" } }),
    prisma.user.create({ data: { email: "auditor-two@example.test", name: "Auditor Two", passwordHash: "test-hash", role: "AUDITOR" } }),
    prisma.user.create({ data: { email: "admin@example.test", name: "Admin", passwordHash: "test-hash", role: "ADMINISTRATOR" } }),
    prisma.user.create({ data: { email: "analyst@example.test", name: "Analyst", passwordHash: "test-hash", role: "SECURITY_ANALYST" } }),
  ]);
  [auditorId, secondAuditorId, administratorId] = users.map(({ id }) => id);
});

after(async () => {
  await prisma.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

after(async () => {
  await prisma.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

const actor = (id: string, role: Role) => ({ id, role });
let counter = 0;

async function inReviewEngagement() {
  const created = await createEngagement(prisma, actor(auditorId, "AUDITOR"), {
    title: "Approval precondition audit",
    auditedOrganization: "Example Bank",
    scope: "Review access governance controls.",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    assignedAuditorId: auditorId,
  });
  await transitionEngagement(prisma, auditorId, created.id, "IN_PROGRESS");
  await transitionEngagement(prisma, auditorId, created.id, "IN_REVIEW");
  return created.id;
}

async function addScopeItem(engagementId: string) {
  counter += 1;
  const control = await prisma.cybersecurityControl.create({ data: { code: `APR-${counter}`, title: "Approval test control" } });
  const document = await prisma.regulatoryDocument.create({
    data: {
      code: `APR-DOC-${counter}`,
      title: "Test source",
      issuer: "Test authority",
      sourceUrl: "https://authority.example.test/source",
      kind: "MANDATORY_LAW",
      language: "az",
      versions: { create: { versionLabel: "v1", sourceUrl: "https://authority.example.test/source", verificationStatus: "VERIFIED" } },
    },
    select: { versions: { select: { id: true } } },
  });
  const requirement = await prisma.regulatoryRequirement.create({
    data: { versionId: document.versions[0].id, clauseId: "1.1", topic: "Access", verificationStatus: "VERIFIED" },
  });
  return prisma.auditScopeItem.create({ data: { engagementId, requirementId: requirement.id, controlId: control.id } });
}

async function addAssessment(
  engagementId: string,
  overrides: { approved?: boolean; isCurrent?: boolean; approvedById?: string | null; approvedAt?: Date | null; status?: string } = {},
) {
  const scopeItem = await addScopeItem(engagementId);
  const approved = overrides.approved ?? true;
  return prisma.controlAssessment.create({
    data: {
      scopeItemId: scopeItem.id,
      version: 1,
      isCurrent: overrides.isCurrent ?? true,
      status: overrides.status ?? "COMPLIANT",
      justification: "Reviewed.",
      assessedById: auditorId,
      approvedById: approved ? (overrides.approvedById === undefined ? administratorId : overrides.approvedById) : null,
      approvedAt: approved ? (overrides.approvedAt === undefined ? new Date() : overrides.approvedAt) : null,
    },
  });
}

async function snapshot(engagementId: string) {
  const engagement = await prisma.auditEngagement.findUniqueOrThrow({ where: { id: engagementId } });
  const events = await prisma.auditEvent.findMany({ where: { entityId: engagementId }, orderBy: { id: "asc" } });
  return {
    status: engagement.status,
    approvedById: engagement.approvedById,
    approvedAt: engagement.approvedAt?.toISOString() ?? null,
    events: events.map(({ id }) => id),
  };
}

test("approval succeeds with an approved assessment and an approver other than the preparer", async () => {
  const id = await inReviewEngagement();
  await addAssessment(id);
  await transitionEngagement(prisma, secondAuditorId, id, "APPROVED");
  const row = await prisma.auditEngagement.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "APPROVED");
  assert.equal(row.approvedById, secondAuditorId);
  assert.ok(row.approvedAt);
  const events = await prisma.auditEvent.findMany({ where: { entityId: id, action: "AUDIT_ENGAGEMENT_STATUS_CHANGED" } });
  assert.equal(events.at(-1)?.detail, "IN_REVIEW -> APPROVED");
  assert.equal(events.at(-1)?.outcome, "SUCCESS");
});

test("approval fails without any assessment, and a refused attempt is the only new audit event", async () => {
  const id = await inReviewEngagement();
  const before = await snapshot(id);
  await assert.rejects(transitionEngagement(prisma, secondAuditorId, id, "APPROVED"), ApprovedAssessmentRequiredError);
  const after = await snapshot(id);
  assert.equal(after.status, before.status);
  assert.equal(after.approvedById, null);
  assert.equal(after.approvedAt, null);
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  const extra = await prisma.auditEvent.findMany({ where: { entityId: id, id: { notIn: before.events } } });
  assert.equal(extra.length, 1);
  assert.equal(extra[0].action, "AUDIT_ENGAGEMENT_APPROVAL_REFUSED");
  assert.equal(extra[0].outcome, "FAILURE");
  assert.equal(extra[0].actorId, secondAuditorId);
});

test("approval fails when assessments exist but none is formally approved", async () => {
  const id = await inReviewEngagement();
  await addAssessment(id, { approved: false });
  await addAssessment(id, { approved: false, status: "NOT_TESTED" });
  await assert.rejects(transitionEngagement(prisma, secondAuditorId, id, "APPROVED"), ApprovedAssessmentRequiredError);
  assert.equal((await snapshot(id)).status, "IN_REVIEW");
});

test("half-approved or superseded assessment rows do not count", async () => {
  const id = await inReviewEngagement();
  await addAssessment(id, { approvedById: null });
  await addAssessment(id, { approvedAt: null, approvedById: administratorId });
  await addAssessment(id, { isCurrent: false });
  await assert.rejects(transitionEngagement(prisma, secondAuditorId, id, "APPROVED"), ApprovedAssessmentRequiredError);
  assert.equal((await snapshot(id)).status, "IN_REVIEW");
});

test("an approved assessment in a different engagement does not satisfy the precondition", async () => {
  const id = await inReviewEngagement();
  const other = await inReviewEngagement();
  await addAssessment(other);
  await assert.rejects(transitionEngagement(prisma, secondAuditorId, id, "APPROVED"), ApprovedAssessmentRequiredError);
  assert.equal((await snapshot(id)).status, "IN_REVIEW");
  assert.equal((await snapshot(other)).status, "IN_REVIEW");
});

test("the preparer cannot approve their own engagement, even with an approved assessment", async () => {
  const id = await inReviewEngagement();
  await addAssessment(id);
  const before = await snapshot(id);
  await assert.rejects(transitionEngagement(prisma, auditorId, id, "APPROVED"), IndependentApproverRequiredError);
  const after = await snapshot(id);
  assert.equal(after.status, "IN_REVIEW");
  assert.equal(after.approvedById, null);
  const refused = await prisma.auditEvent.findMany({
    where: { entityId: id, id: { notIn: before.events }, action: "AUDIT_ENGAGEMENT_APPROVAL_REFUSED" },
  });
  assert.equal(refused.length, 1);
  assert.equal(refused[0].outcome, "FAILURE");
  // The assigned auditor is not treated as the preparer: an administrator who did not create it may approve.
  await transitionEngagement(prisma, administratorId, id, "APPROVED");
  assert.equal((await snapshot(id)).status, "APPROVED");
});

test("roles without audit:manage cannot reach the approval transition", () => {
  // Authorization (permission + engagement membership) is enforced by requireEngagementPermission
  // before transitionEngagement is called; the permission matrix decides who gets that far.
  for (const role of ["READ_ONLY_REVIEWER", "SECURITY_ANALYST"]) assert.equal(hasPermission(role, "audit:manage"), false);
  for (const role of ["AUDITOR", "ADMINISTRATOR"]) assert.equal(hasPermission(role, "audit:manage"), true);
});

test("an already approved or archived engagement cannot be approved again", async () => {
  const id = await inReviewEngagement();
  await addAssessment(id);
  await transitionEngagement(prisma, secondAuditorId, id, "APPROVED");
  const approved = await snapshot(id);
  await assert.rejects(transitionEngagement(prisma, administratorId, id, "APPROVED"), InvalidEngagementTransitionError);
  assert.deepEqual(await snapshot(id), approved);
  await transitionEngagement(prisma, administratorId, id, "ARCHIVED");
  const archived = await snapshot(id);
  await assert.rejects(transitionEngagement(prisma, administratorId, id, "APPROVED"), InvalidEngagementTransitionError);
  assert.deepEqual(await snapshot(id), archived);
});

test("concurrent approval attempts without preconditions never succeed; with them exactly one wins", async () => {
  const blocked = await inReviewEngagement();
  const outcomes = await Promise.allSettled([
    transitionEngagement(prisma, secondAuditorId, blocked, "APPROVED"),
    transitionEngagement(prisma, administratorId, blocked, "APPROVED"),
    transitionEngagement(prisma, auditorId, blocked, "APPROVED"),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 0);
  const row = await prisma.auditEngagement.findUniqueOrThrow({ where: { id: blocked } });
  assert.equal(row.status, "IN_REVIEW");
  assert.equal(row.approvedById, null);

  const ready = await inReviewEngagement();
  await addAssessment(ready);
  const race = await Promise.allSettled([
    transitionEngagement(prisma, secondAuditorId, ready, "APPROVED"),
    transitionEngagement(prisma, administratorId, ready, "APPROVED"),
    transitionEngagement(prisma, auditorId, ready, "APPROVED"),
  ]);
  assert.equal(race.filter(({ status }) => status === "fulfilled").length, 1);
  const final = await prisma.auditEngagement.findUniqueOrThrow({ where: { id: ready } });
  assert.equal(final.status, "APPROVED");
  assert.notEqual(final.approvedById, auditorId);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: ready, detail: "IN_REVIEW -> APPROVED" } }), 1);
});

test("assessment approval through the real service unlocks engagement approval", async () => {
  // Assessments change while the engagement is IN_PROGRESS, so build this one through the real lifecycle.
  const working = await createEngagement(prisma, actor(auditorId, "AUDITOR"), {
    title: "Workflow audit",
    auditedOrganization: "Example Bank",
    scope: "Review access governance controls.",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    assignedAuditorId: auditorId,
  });
  await transitionEngagement(prisma, auditorId, working.id, "IN_PROGRESS");
  const scopeItem = await addScopeItem(working.id);
  const revision = await createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), working.id, scopeItem.id, {
    expectedVersion: 0,
    status: "NOT_APPLICABLE",
    notApplicableReason: "Control does not apply to this fictional scope.",
    evidenceIds: [],
  });
  await transitionEngagement(prisma, auditorId, working.id, "IN_REVIEW");
  await assert.rejects(transitionEngagement(prisma, secondAuditorId, working.id, "APPROVED"), ApprovedAssessmentRequiredError);
  await approveAssessment(prisma, actor(administratorId, "ADMINISTRATOR"), working.id, revision.id, {
    justification: "Reviewed the not-applicable rationale.",
  });
  await transitionEngagement(prisma, secondAuditorId, working.id, "APPROVED");
  assert.equal((await snapshot(working.id)).status, "APPROVED");
});
