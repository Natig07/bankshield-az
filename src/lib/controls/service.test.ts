import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { PermissionDeniedError, type Role } from "@/lib/auth/authorization";
import { canAccessEngagement } from "@/lib/auth/resource-access";
import { getControlCatalogue, normalizeControlSearch } from "./data";
import {
  approveAssessment,
  ConcurrentAssessmentRevisionError,
  ControlRecordNotFoundError,
  createAssessmentRevision,
  createControl,
  createRequirementControlMapping,
  DuplicateControlRecordError,
  DuplicateRequirementMappingError,
  InvalidAssessmentApprovalError,
  InvalidAssessmentEvidenceError,
  updateControl,
} from "./service";

let prisma: PrismaClient;
let testDirectory: string;
let databasePath: string;
let adminId: string;
let auditorId: string;
let secondAuditorId: string;
let viewerId: string;
let nextCode = 1;

const actor = (id: string, role: Role) => ({ id, role });

before(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "bankshield-controls-tests-"));
  databasePath = join(testDirectory, "controls-tests.db");
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
    prisma.user.create({ data: { email: "controls-admin@example.test", name: "Admin", passwordHash: "test", role: "ADMINISTRATOR" } }),
    prisma.user.create({ data: { email: "controls-auditor@example.test", name: "Auditor", passwordHash: "test", role: "AUDITOR" } }),
    prisma.user.create({ data: { email: "controls-other-auditor@example.test", name: "Other Auditor", passwordHash: "test", role: "AUDITOR" } }),
    prisma.user.create({ data: { email: "controls-viewer@example.test", name: "Viewer", passwordHash: "test", role: "READ_ONLY_REVIEWER" } }),
  ]);
  [adminId, auditorId, secondAuditorId, viewerId] = users.map(({ id }) => id);
});

after(async () => {
  await prisma.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

function uniqueCode(prefix: string) {
  return `${prefix}-${String(nextCode++).padStart(4, "0")}`;
}

async function createEngagement(ownerId = auditorId) {
  const engagement = await prisma.auditEngagement.create({
    data: {
      title: "Control workflow test",
      auditedOrganization: "Fixture Bank",
      scope: "Synthetic test scope.",
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-01-31T00:00:00.000Z"),
      createdById: ownerId,
      members: { create: { userId: ownerId } },
    },
    select: { id: true },
  });
  return engagement.id;
}

async function createRequirement(status = "PENDING_VERIFICATION") {
  const document = await prisma.regulatoryDocument.create({
    data: {
      code: uniqueCode("FIXTURE"),
      title: "Synthetic fixture source",
      issuer: "Test authority",
      sourceUrl: "https://authority.example.test/document",
      kind: "MANDATORY_LAW",
      language: "az",
      versions: {
        create: {
          versionLabel: "fixture-1",
          sourceUrl: "https://authority.example.test/document",
          verificationStatus: status,
        },
      },
    },
    select: { versions: { select: { id: true } } },
  });
  return prisma.regulatoryRequirement.create({
    data: { versionId: document.versions[0].id, clauseId: "TEST-1", topic: "Test topic", verificationStatus: status },
    select: { id: true, verificationStatus: true },
  });
}

async function createControlFixture() {
  return createControl(prisma, actor(adminId, "ADMINISTRATOR"), {
    code: uniqueCode("CTRL"),
    title: "Access governance",
    description: "Test control description.",
    domain: "Identity",
    source: "INTERNAL",
  });
}

async function createScopeItem(engagementId: string, controlId: string, requirementId: string) {
  return prisma.auditScopeItem.create({
    data: { engagementId, controlId, requirementId },
    select: { id: true },
  });
}

async function createEvidence(engagementId: string, controlId: string | null) {
  return prisma.evidenceDocument.create({
    data: {
      engagementId,
      controlId,
      originalName: "synthetic-test-evidence.pdf",
      storageKey: uniqueCode("fixture-key"),
      mimeType: "application/pdf",
      sizeBytes: 128,
      sha256: "a".repeat(64),
      uploadedById: auditorId,
    },
    select: { id: true },
  });
}

test("empty and populated control catalogue queries are honest and searchable", async () => {
  assert.equal(normalizeControlSearch("  Access  "), "Access");
  assert.equal(normalizeControlSearch("x".repeat(200)).length, 120);
  assert.deepEqual(await getControlCatalogue(prisma, "no-such-control"), []);
  const control = await createControlFixture();
  const results = await getControlCatalogue(prisma, "access governance");
  assert.ok(results.some(({ id }) => id === control.id));
});

test("administrator can create/update controls and duplicate codes are rejected", async () => {
  const control = await createControlFixture();
  await updateControl(prisma, actor(adminId, "ADMINISTRATOR"), control.id, {
    code: "CTRL-UPDATED",
    title: "Updated access governance",
    description: "Updated description.",
    domain: "Identity",
    source: "NIST_CSF",
  });
  assert.equal(
    (await prisma.cybersecurityControl.findUniqueOrThrow({ where: { id: control.id } })).title,
    "Updated access governance",
  );
  await assert.rejects(
    createControl(prisma, actor(adminId, "ADMINISTRATOR"), {
      code: "CTRL-UPDATED",
      title: "Duplicate control",
      description: null,
      domain: null,
      source: "INTERNAL",
    }),
    DuplicateControlRecordError,
  );
  await assert.rejects(
    createControl(prisma, actor(viewerId, "READ_ONLY_REVIEWER"), {
      code: "CTRL-DENIED",
      title: "Unauthorized control",
      source: "INTERNAL",
    }),
    PermissionDeniedError,
  );
});

test("mapping requires rationale, prevents duplicates, and never changes verification state", async () => {
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const input = { controlId: control.id, requirementId: requirement.id, rationale: "Directly supports access governance." };
  await createRequirementControlMapping(prisma, actor(adminId, "ADMINISTRATOR"), input);
  await assert.rejects(
    createRequirementControlMapping(prisma, actor(adminId, "ADMINISTRATOR"), input),
    DuplicateRequirementMappingError,
  );
  await assert.rejects(
    createRequirementControlMapping(prisma, actor(adminId, "ADMINISTRATOR"), { ...input, rationale: "short" }),
  );
  await assert.rejects(
    createRequirementControlMapping(prisma, actor(viewerId, "READ_ONLY_REVIEWER"), {
      ...input,
      requirementId: (await createRequirement()).id,
    }),
    PermissionDeniedError,
  );
  assert.equal(
    (await prisma.regulatoryRequirement.findUniqueOrThrow({ where: { id: requirement.id } })).verificationStatus,
    "PENDING_VERIFICATION",
  );
  assert.equal(await prisma.requirementControlMapping.count({ where: input }), 1);
});

test("assessment revisions preserve approval history and link evidence to the exact assessment", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  const evidence = await createEvidence(engagementId, control.id);

  await assert.rejects(
    createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
      status: "NOT_APPLICABLE",
      notApplicableReason: " ",
      evidenceIds: [],
    }),
  );
  const first = await createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "COMPLIANT",
    notApplicableReason: null,
    evidenceIds: [evidence.id],
  });
  await assert.rejects(
    approveAssessment(prisma, actor(auditorId, "AUDITOR"), engagementId, first.id, { justification: "review" }),
  );
  await approveAssessment(prisma, actor(auditorId, "AUDITOR"), engagementId, first.id, {
    justification: "Reviewed supporting evidence.",
  });

  const second = await createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "PARTIALLY_COMPLIANT",
    notApplicableReason: null,
    evidenceIds: [],
  });
  const revisions = await prisma.controlAssessment.findMany({
    where: { scopeItemId: scopeItem.id },
    orderBy: { version: "asc" },
    include: { evidenceLinks: true },
  });
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0].isCurrent, false);
  assert.ok(revisions[0].approvedAt);
  assert.equal(revisions[0].justification, "Reviewed supporting evidence.");
  assert.equal(revisions[0].evidenceLinks[0].evidenceId, evidence.id);
  assert.equal(revisions[1].id, second.id);
  assert.equal(revisions[1].isCurrent, true);
  assert.equal(await prisma.controlAssessmentEvidence.count({ where: { assessmentId: second.id } }), 0);
  assert.equal(await prisma.controlAssessment.count({ where: { scopeItemId: scopeItem.id, isCurrent: true } }), 1);
});

test("approval rejects NOT_TESTED and invalid evidence, and NOT_APPLICABLE needs a reason but no evidence", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement("VERIFIED");
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  const untested = await createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "NOT_TESTED",
    notApplicableReason: null,
    evidenceIds: [],
  });
  await assert.rejects(
    approveAssessment(prisma, actor(auditorId, "AUDITOR"), engagementId, untested.id, {
      justification: "Reviewed current results.",
    }),
    InvalidAssessmentApprovalError,
  );

  const outsideEvidence = await createEvidence(await createEngagement(secondAuditorId), control.id);
  await assert.rejects(
    createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
      status: "COMPLIANT",
      notApplicableReason: null,
      evidenceIds: [outsideEvidence.id],
    }),
    InvalidAssessmentEvidenceError,
  );

  const notApplicable = await createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "NOT_APPLICABLE",
    notApplicableReason: "The service is not provided by this institution.",
    evidenceIds: [],
  });
  await approveAssessment(prisma, actor(auditorId, "AUDITOR"), engagementId, notApplicable.id, {
    justification: "Scope reviewed and approved.",
  });
  assert.ok((await prisma.controlAssessment.findUniqueOrThrow({ where: { id: notApplicable.id } })).approvedAt);
});

test("assessment mutation requires assessment permission and matching engagement scope", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  await assert.rejects(
    createAssessmentRevision(prisma, actor(viewerId, "READ_ONLY_REVIEWER"), engagementId, scopeItem.id, {
      status: "COMPLIANT",
      notApplicableReason: null,
      evidenceIds: [],
    }),
    PermissionDeniedError,
  );
  await assert.rejects(
    createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), "another-engagement", scopeItem.id, {
      status: "COMPLIANT",
      notApplicableReason: null,
      evidenceIds: [],
    }),
    ControlRecordNotFoundError,
  );
  const auditor = { id: auditorId, role: "AUDITOR" as const, email: "controls-auditor@example.test", name: "Auditor", preferredLocale: "en" };
  const otherAuditor = { id: secondAuditorId, role: "AUDITOR" as const, email: "controls-other-auditor@example.test", name: "Other Auditor", preferredLocale: "en" };
  assert.equal(await canAccessEngagement(prisma, auditor, engagementId), true);
  assert.equal(await canAccessEngagement(prisma, otherAuditor, engagementId), false);
});

test("concurrent revisions retain exactly one current assessment", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  const outcomes = await Promise.allSettled([
    createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
      status: "COMPLIANT",
      notApplicableReason: null,
      evidenceIds: [],
    }),
    createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
      status: "PARTIALLY_COMPLIANT",
      notApplicableReason: null,
      evidenceIds: [],
    }),
  ]);
  assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
  const assessments = await prisma.controlAssessment.findMany({ where: { scopeItemId: scopeItem.id } });
  assert.equal(assessments.filter(({ isCurrent }) => isCurrent).length, 1);
  assert.equal(new Set(assessments.map(({ version }) => version)).size, assessments.length);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      assert.ok(
        outcome.reason instanceof ConcurrentAssessmentRevisionError ||
          (outcome.reason instanceof Error && outcome.reason.name === "PrismaClientKnownRequestError"),
      );
    }
  }
});

test("catalogue query failures propagate instead of becoming an empty result", async () => {
  const uninitializedDatabase = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: join(testDirectory, "uninitialized.db") }),
  });
  await assert.rejects(getControlCatalogue(uninitializedDatabase, ""));
  await uninitializedDatabase.$disconnect();
});
