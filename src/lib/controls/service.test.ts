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
import { EngagementLockedError } from "@/lib/audits/service";
import { getControlCatalogue, normalizeControlSearch } from "./data";
import {
  approveAssessment,
  ConcurrentAssessmentRevisionError,
  ControlRecordNotFoundError,
  createAssessmentRevision,
  IndependentApprovalRequiredError,
  StaleAssessmentRevisionError,
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

// Records a revision against the latest stored version, the way the UI does after
// loading the page. Stale-version behaviour is tested explicitly below.
async function revise(
  author: { id: string; role: Role },
  engagementId: string,
  scopeItemId: string,
  input: { status: string; notApplicableReason: string | null; evidenceIds: string[] },
) {
  const latest = await prisma.controlAssessment.findFirst({
    where: { scopeItemId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return createAssessmentRevision(prisma, author, engagementId, scopeItemId, {
    ...input,
    expectedVersion: latest?.version ?? 0,
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
    revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
      status: "NOT_APPLICABLE",
      notApplicableReason: " ",
      evidenceIds: [],
    }),
  );
  const first = await revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "COMPLIANT",
    notApplicableReason: null,
    evidenceIds: [evidence.id],
  });
  await assert.rejects(
    approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, first.id, { justification: "review" }),
  );
  await approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, first.id, {
    justification: "Reviewed supporting evidence.",
  });

  const second = await revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
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
  const untested = await revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "NOT_TESTED",
    notApplicableReason: null,
    evidenceIds: [],
  });
  await assert.rejects(
    approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, untested.id, {
      justification: "Reviewed current results.",
    }),
    InvalidAssessmentApprovalError,
  );

  const outsideEvidence = await createEvidence(await createEngagement(secondAuditorId), control.id);
  await assert.rejects(
    revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
      status: "COMPLIANT",
      notApplicableReason: null,
      evidenceIds: [outsideEvidence.id],
    }),
    InvalidAssessmentEvidenceError,
  );

  const notApplicable = await revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "NOT_APPLICABLE",
    notApplicableReason: "The service is not provided by this institution.",
    evidenceIds: [],
  });
  await approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, notApplicable.id, {
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
    revise(actor(viewerId, "READ_ONLY_REVIEWER"), engagementId, scopeItem.id, {
      status: "COMPLIANT",
      notApplicableReason: null,
      evidenceIds: [],
    }),
    PermissionDeniedError,
  );
  await assert.rejects(
    revise(actor(auditorId, "AUDITOR"), "another-engagement", scopeItem.id, {
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
    revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
      status: "COMPLIANT",
      notApplicableReason: null,
      evidenceIds: [],
    }),
    revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
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
          outcome.reason instanceof StaleAssessmentRevisionError ||
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

test("a revision saved against an outdated version is rejected as stale", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  const input = { status: "COMPLIANT", notApplicableReason: null, evidenceIds: [] };

  await assert.rejects(
    createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, { ...input, expectedVersion: 3 }),
    StaleAssessmentRevisionError,
  );
  await assert.rejects(
    createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, { ...input }),
  );
  const first = await createAssessmentRevision(prisma, actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, { ...input, expectedVersion: 0 });
  assert.equal(first.version, 1);
  // A second author still holding the "nothing recorded" view must not overwrite revision 1.
  await assert.rejects(
    createAssessmentRevision(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, scopeItem.id, { ...input, status: "NON_COMPLIANT", expectedVersion: 0 }),
    StaleAssessmentRevisionError,
  );
  const second = await createAssessmentRevision(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, scopeItem.id, { ...input, status: "NON_COMPLIANT", expectedVersion: 1 });
  assert.equal(second.version, 2);
  assert.equal(await prisma.controlAssessment.count({ where: { scopeItemId: scopeItem.id } }), 2);
  assert.equal(await prisma.controlAssessment.count({ where: { scopeItemId: scopeItem.id, isCurrent: true } }), 1);
});

test("the author of a revision cannot approve it; an independent user can", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  const evidence = await createEvidence(engagementId, control.id);
  const revision = await revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "COMPLIANT",
    notApplicableReason: null,
    evidenceIds: [evidence.id],
  });

  await assert.rejects(
    approveAssessment(prisma, actor(auditorId, "AUDITOR"), engagementId, revision.id, { justification: "Self review of my own work." }),
    IndependentApprovalRequiredError,
  );
  assert.equal((await prisma.controlAssessment.findUniqueOrThrow({ where: { id: revision.id } })).approvedAt, null);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: engagementId, action: "CONTROL_ASSESSMENT_APPROVED" } }), 0);

  await assert.rejects(
    approveAssessment(prisma, actor(viewerId, "READ_ONLY_REVIEWER"), engagementId, revision.id, { justification: "Viewer should not approve." }),
    PermissionDeniedError,
  );
  await approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, revision.id, { justification: "Independent review of the evidence." });
  const approved = await prisma.controlAssessment.findUniqueOrThrow({ where: { id: revision.id } });
  assert.equal(approved.approvedById, adminId);
  assert.equal(approved.assessedById, auditorId);

  // An administrator who authored a revision is bound by the same rule.
  const adminRevision = await revise(actor(adminId, "ADMINISTRATOR"), engagementId, scopeItem.id, {
    status: "NOT_APPLICABLE",
    notApplicableReason: "Service is not offered.",
    evidenceIds: [],
  });
  await assert.rejects(
    approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, adminRevision.id, { justification: "Self approval attempt." }),
    IndependentApprovalRequiredError,
  );
  await approveAssessment(prisma, actor(auditorId, "AUDITOR"), engagementId, adminRevision.id, { justification: "Auditor reviewed the exclusion." });
});

test("revisions with no recorded author (legacy rows) remain approvable", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  const legacy = await prisma.controlAssessment.create({
    data: { scopeItemId: scopeItem.id, version: 1, status: "NOT_APPLICABLE", notApplicableReason: "Legacy row." },
    select: { id: true },
  });
  await approveAssessment(prisma, actor(auditorId, "AUDITOR"), engagementId, legacy.id, { justification: "Reviewed legacy record." });
  assert.ok((await prisma.controlAssessment.findUniqueOrThrow({ where: { id: legacy.id } })).approvedAt);
});

test("assessment changes follow the engagement status lock", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  const input = { status: "NOT_APPLICABLE", notApplicableReason: "Out of scope for this institution.", evidenceIds: [] };

  const revision = await revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, input);
  const setStatus = (status: string) => prisma.auditEngagement.update({ where: { id: engagementId }, data: { status } });

  // IN_REVIEW freezes new revisions but still lets the checker approve.
  await setStatus("IN_REVIEW");
  await assert.rejects(revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, input), EngagementLockedError);
  await approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, revision.id, { justification: "Reviewed during engagement review." });

  for (const status of ["APPROVED", "ARCHIVED"]) {
    await setStatus(status);
    await assert.rejects(revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, input), EngagementLockedError);
  }
  const another = await createScopeItem(engagementId, (await createControlFixture()).id, requirement.id);
  await setStatus("IN_PROGRESS");
  const pending = await revise(actor(auditorId, "AUDITOR"), engagementId, another.id, input);
  await setStatus("APPROVED");
  await assert.rejects(
    approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, pending.id, { justification: "Too late to approve." }),
    EngagementLockedError,
  );
  assert.equal((await prisma.controlAssessment.findUniqueOrThrow({ where: { id: pending.id } })).approvedAt, null);
});

test("rejected or superseded evidence cannot support an assessment", async () => {
  const engagementId = await createEngagement();
  const control = await createControlFixture();
  const requirement = await createRequirement();
  const scopeItem = await createScopeItem(engagementId, control.id, requirement.id);
  const rejected = await createEvidence(engagementId, control.id);
  await prisma.evidenceDocument.update({ where: { id: rejected.id }, data: { reviewStatus: "REJECTED" } });
  await assert.rejects(
    revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, { status: "COMPLIANT", notApplicableReason: null, evidenceIds: [rejected.id] }),
    InvalidAssessmentEvidenceError,
  );

  // Evidence rejected after it was linked no longer counts at approval time.
  const usable = await createEvidence(engagementId, control.id);
  const revision = await revise(actor(auditorId, "AUDITOR"), engagementId, scopeItem.id, {
    status: "COMPLIANT",
    notApplicableReason: null,
    evidenceIds: [usable.id],
  });
  await prisma.evidenceDocument.update({ where: { id: usable.id }, data: { reviewStatus: "REJECTED" } });
  await assert.rejects(
    approveAssessment(prisma, actor(adminId, "ADMINISTRATOR"), engagementId, revision.id, { justification: "Evidence was withdrawn." }),
    InvalidAssessmentApprovalError,
  );
});
