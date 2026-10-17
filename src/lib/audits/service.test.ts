import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import {
  addEngagementParticipant,
  assignEngagementAuditor,
  createEngagement,
  DuplicateEngagementRecordError,
  EngagementLockedError,
  engagementInputSchema,
  InvalidAuditorError,
  InvalidEngagementTransitionError,
  InvalidParticipantError,
  removeEngagementParticipant,
  selectEngagementRequirement,
  UnverifiedRequirementDecisionError,
  updateEngagement,
} from "./service";
import { transitionEngagement } from "./service";
import type { Role } from "@/lib/auth/authorization";
import { canAccessEngagement } from "@/lib/auth/resource-access";

let prisma: PrismaClient;
let testDirectory: string;
let auditorId: string;
let secondAuditorId: string;
let administratorId: string;
let viewerId: string;
let analystId: string;
let inactiveAnalystId: string;

before(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "bankshield-audits-tests-"));
  const databasePath = join(testDirectory, "audits-tests.db");
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
    prisma.user.create({ data: { email: "viewer@example.test", name: "Viewer", passwordHash: "test-hash", role: "READ_ONLY_REVIEWER" } }),
    prisma.user.create({ data: { email: "analyst@example.test", name: "Analyst", passwordHash: "test-hash", role: "SECURITY_ANALYST" } }),
    prisma.user.create({ data: { email: "inactive-analyst@example.test", name: "Inactive Analyst", passwordHash: "test-hash", role: "SECURITY_ANALYST", isActive: false } }),
  ]);
  [auditorId, secondAuditorId, administratorId, viewerId, analystId, inactiveAnalystId] = users.map(({ id }) => id);
});

after(async () => {
  await prisma.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

const validInput = (assignedAuditorId: string) => ({
  title: "Quarterly security audit",
  auditedOrganization: "Example Bank",
  scope: "Review access governance controls.",
  periodStart: "2026-01-01",
  periodEnd: "2026-03-31",
  assignedAuditorId,
});

const actor = (id: string, role: Role) => ({ id, role });

async function createRequirement(verificationStatus = "PENDING_VERIFICATION") {
  const control = await prisma.cybersecurityControl.create({
    data: {
      code: `TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      title: "Test access control",
    },
  });
  const document = await prisma.regulatoryDocument.create({
    data: {
      code: `TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      title: "Test regulatory source",
      issuer: "Test authority",
      sourceUrl: "https://authority.example.test/source",
      kind: "MANDATORY_LAW",
      language: "az",
      versions: {
        create: {
          versionLabel: "test-version",
          sourceUrl: "https://authority.example.test/source",
          verificationStatus: "PENDING_VERIFICATION",
        },
      },
    },
    select: { versions: { select: { id: true } } },
  });
  const requirement = await prisma.regulatoryRequirement.create({
    data: {
      versionId: document.versions[0].id,
      clauseId: "4.1",
      topic: "Access governance",
      verificationStatus,
    },
  });
  await prisma.requirementControlMapping.create({
    data: { requirementId: requirement.id, controlId: control.id },
  });
  return requirement;
}

test("engagement creation validates fields and records the assigned auditor and audit event", async () => {
  assert.equal(engagementInputSchema.safeParse({
    ...validInput(auditorId),
    periodStart: "2026-02-31",
  }).success, false);
  assert.equal(engagementInputSchema.safeParse({
    ...validInput(auditorId),
    periodStart: "2026-04-01",
    periodEnd: "2026-03-31",
  }).success, false);
  assert.equal(engagementInputSchema.safeParse({
    ...validInput(auditorId),
    auditedOrganization: " ",
  }).success, false);

  const created = await createEngagement(prisma, actor(auditorId, "AUDITOR"), validInput(auditorId));
  const engagement = await prisma.auditEngagement.findUniqueOrThrow({
    where: { id: created.id },
    include: { members: true },
  });
  assert.equal(engagement.auditedOrganization, "Example Bank");
  assert.equal(engagement.status, "DRAFT");
  assert.deepEqual(engagement.members.map(({ userId }) => userId), [auditorId]);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: created.id } }), 1);

  await assert.rejects(
    createEngagement(prisma, actor(auditorId, "AUDITOR"), validInput(secondAuditorId)),
    InvalidAuditorError,
  );
  await assert.rejects(
    createEngagement(prisma, actor(administratorId, "ADMINISTRATOR"), validInput(viewerId)),
    InvalidAuditorError,
  );
});

test("metadata updates preserve assignment and status changes follow the supported transition graph", async () => {
  const created = await createEngagement(prisma, actor(auditorId, "AUDITOR"), validInput(auditorId));
  await updateEngagement(prisma, auditorId, created.id, {
    ...validInput(auditorId),
    title: "Updated security audit",
    scope: "Updated scope.",
  });
  assert.equal(await prisma.auditEngagementMember.count({ where: { engagementId: created.id, userId: auditorId } }), 1);
  assert.equal((await prisma.auditEngagement.findUniqueOrThrow({ where: { id: created.id } })).status, "DRAFT");
  await assert.rejects(
    transitionEngagement(prisma, auditorId, created.id, "APPROVED"),
    InvalidEngagementTransitionError,
  );
  await transitionEngagement(prisma, auditorId, created.id, "IN_PROGRESS");
  await transitionEngagement(prisma, auditorId, created.id, "IN_REVIEW");
  await transitionEngagement(prisma, auditorId, created.id, "APPROVED");
  const approved = await prisma.auditEngagement.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(approved.status, "APPROVED");
  assert.ok(approved.approvedAt);
  assert.equal(approved.approvedById, auditorId);
  const approvedAt = approved.approvedAt;
  await transitionEngagement(prisma, auditorId, created.id, "ARCHIVED");
  const archived = await prisma.auditEngagement.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(archived.approvedById, auditorId);
  assert.equal(archived.approvedAt?.toISOString(), approvedAt.toISOString());
  assert.equal(await prisma.auditEvent.count({ where: { entityId: created.id } }), 6);
});

test("auditor assignments are active-auditor-only, duplicate-safe, and append audit events", async () => {
  const created = await createEngagement(prisma, actor(auditorId, "AUDITOR"), validInput(auditorId));
  const priorMembership = await prisma.auditEngagementMember.findFirstOrThrow({
    where: { engagementId: created.id },
  });
  await assignEngagementAuditor(prisma, administratorId, { engagementId: created.id, auditorId: secondAuditorId });
  await assert.rejects(
    assignEngagementAuditor(prisma, administratorId, { engagementId: created.id, auditorId: secondAuditorId }),
    DuplicateEngagementRecordError,
  );
  const updatedMembership = await prisma.auditEngagementMember.findFirstOrThrow({
    where: { engagementId: created.id },
  });
  assert.equal(updatedMembership.id, priorMembership.id);
  assert.equal(updatedMembership.userId, secondAuditorId);
  assert.equal(await prisma.auditEngagementMember.count({ where: { engagementId: created.id } }), 1);
  assert.equal(await prisma.auditEvent.count({
    where: { entityId: created.id, action: "AUDIT_ENGAGEMENT_AUDITOR_ASSIGNED" },
  }), 1);
});

test("requirement scope selection requires an explicit unverified decision and prevents duplicates", async () => {
  const created = await createEngagement(prisma, actor(auditorId, "AUDITOR"), validInput(auditorId));
  const requirement = await createRequirement();
  await assert.rejects(
    selectEngagementRequirement(prisma, auditorId, {
      engagementId: created.id,
      requirementId: requirement.id,
      acknowledgeUnverified: false,
      decisionNote: "",
    }),
    UnverifiedRequirementDecisionError,
  );
  await selectEngagementRequirement(prisma, auditorId, {
    engagementId: created.id,
    requirementId: requirement.id,
    acknowledgeUnverified: true,
    decisionNote: "Include for preliminary review; legal applicability is unconfirmed.",
  });
  await assert.rejects(
    selectEngagementRequirement(prisma, auditorId, {
      engagementId: created.id,
      requirementId: requirement.id,
      acknowledgeUnverified: true,
      decisionNote: "Duplicate",
    }),
    DuplicateEngagementRecordError,
  );
  await prisma.regulatoryRequirement.update({
    where: { id: requirement.id },
    data: { verificationStatus: "VERIFIED" },
  });
  const recorded = await prisma.auditRequirementSelection.findUniqueOrThrow({
    where: { engagementId_requirementId: { engagementId: created.id, requirementId: requirement.id } },
  });
  assert.equal(recorded.verificationStatusAtSelection, "PENDING_VERIFICATION");
  assert.equal(recorded.unverifiedAcknowledged, true);
  assert.equal(recorded.decisionNote, "Include for preliminary review; legal applicability is unconfirmed.");
  assert.equal(await prisma.auditScopeItem.count({
    where: { engagementId: created.id, requirementId: requirement.id },
  }), 1);

  const verifiedRequirement = await createRequirement("VERIFIED");
  await selectEngagementRequirement(prisma, auditorId, {
    engagementId: created.id,
    requirementId: verifiedRequirement.id,
    acknowledgeUnverified: false,
    decisionNote: "",
  });
});

test("approved, archived and in-review engagements lock scope, metadata and assignment changes", async () => {
  const created = await createEngagement(prisma, actor(auditorId, "AUDITOR"), validInput(auditorId));
  const requirement = await createRequirement("VERIFIED");
  const attempt = async () => {
    await assert.rejects(updateEngagement(prisma, auditorId, created.id, validInput(auditorId)), EngagementLockedError);
    await assert.rejects(
      selectEngagementRequirement(prisma, auditorId, {
        engagementId: created.id,
        requirementId: requirement.id,
        acknowledgeUnverified: false,
        decisionNote: "",
      }),
      EngagementLockedError,
    );
    await assert.rejects(
      assignEngagementAuditor(prisma, administratorId, { engagementId: created.id, auditorId: secondAuditorId }),
      EngagementLockedError,
    );
  };
  await transitionEngagement(prisma, auditorId, created.id, "IN_PROGRESS");
  await transitionEngagement(prisma, auditorId, created.id, "IN_REVIEW");
  await attempt();
  await transitionEngagement(prisma, auditorId, created.id, "APPROVED");
  await attempt();
  await transitionEngagement(prisma, auditorId, created.id, "ARCHIVED");
  await attempt();
  assert.equal(await prisma.auditRequirementSelection.count({ where: { engagementId: created.id } }), 0);
  assert.equal(await prisma.auditEngagementMember.count({ where: { engagementId: created.id, userId: secondAuditorId } }), 0);

  await assert.rejects(
    updateEngagement(prisma, auditorId, "missing-engagement", validInput(auditorId)),
    /no longer exists/,
  );
});

test("duplicate concurrent status transitions allow exactly one winner", async () => {
  const created = await createEngagement(prisma, actor(auditorId, "AUDITOR"), validInput(auditorId));
  await transitionEngagement(prisma, auditorId, created.id, "IN_PROGRESS");
  // Two requests made from the same loaded state (IN_PROGRESS -> IN_REVIEW); the loser
  // must be rejected instead of recording a second, impossible IN_PROGRESS -> IN_REVIEW.
  const outcomes = await Promise.allSettled([
    transitionEngagement(prisma, auditorId, created.id, "IN_REVIEW"),
    transitionEngagement(prisma, auditorId, created.id, "IN_REVIEW"),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected" && rejected.reason instanceof InvalidEngagementTransitionError);
  const events = await prisma.auditEvent.count({ where: { entityId: created.id, action: "AUDIT_ENGAGEMENT_STATUS_CHANGED" } });
  assert.equal(events, 2);
});

test("analysts join as participants without disturbing the auditor slot", async () => {
  const created = await createEngagement(prisma, actor(auditorId, "AUDITOR"), validInput(auditorId));
  await assert.rejects(addEngagementParticipant(prisma, administratorId, { engagementId: created.id, userId: secondAuditorId }), InvalidParticipantError);
  await assert.rejects(addEngagementParticipant(prisma, administratorId, { engagementId: created.id, userId: viewerId }), InvalidParticipantError);
  await assert.rejects(addEngagementParticipant(prisma, administratorId, { engagementId: created.id, userId: inactiveAnalystId }), InvalidParticipantError);
  await addEngagementParticipant(prisma, administratorId, { engagementId: created.id, userId: analystId });
  await assert.rejects(
    addEngagementParticipant(prisma, administratorId, { engagementId: created.id, userId: analystId }),
    DuplicateEngagementRecordError,
  );
  assert.equal(await canAccessEngagement(prisma, { id: analystId, role: "SECURITY_ANALYST" }, created.id), true);

  // Reassigning the auditor replaces the auditor, not the analyst who joined later.
  await assignEngagementAuditor(prisma, administratorId, { engagementId: created.id, auditorId: secondAuditorId });
  const members = await prisma.auditEngagementMember.findMany({ where: { engagementId: created.id } });
  assert.deepEqual(members.map(({ userId }) => userId).sort(), [analystId, secondAuditorId].sort());

  await assert.rejects(removeEngagementParticipant(prisma, administratorId, { engagementId: created.id, userId: secondAuditorId }), InvalidParticipantError);
  await removeEngagementParticipant(prisma, administratorId, { engagementId: created.id, userId: analystId });
  assert.equal(await canAccessEngagement(prisma, { id: analystId, role: "SECURITY_ANALYST" }, created.id), false);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: created.id, action: { in: ["AUDIT_ENGAGEMENT_PARTICIPANT_ADDED", "AUDIT_ENGAGEMENT_PARTICIPANT_REMOVED"] } } }), 2);

  await transitionEngagement(prisma, secondAuditorId, created.id, "IN_PROGRESS");
  await transitionEngagement(prisma, secondAuditorId, created.id, "IN_REVIEW");
  await assert.rejects(addEngagementParticipant(prisma, administratorId, { engagementId: created.id, userId: analystId }), EngagementLockedError);
});
