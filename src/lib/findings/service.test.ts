import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { ZodError } from "zod";
import { PrismaClient } from "@/generated/prisma/client";
import { PermissionDeniedError, type Role } from "@/lib/auth/authorization";
import { EngagementLockedError } from "@/lib/audits/service";
import { getFindingDetails, getFindingEngagements, getFindingList, normalizeFindingFilters, summarizeFindings } from "./data";
import {
  addRemediationAction,
  createFinding,
  FindingLockedError,
  FindingNotFoundError,
  FindingRuleError,
  InvalidFindingTransitionError,
  StaleFindingError,
  transitionFinding,
  updateFinding,
  updateRemediationStatus,
} from "./service";
import { canTransitionFinding, canTransitionRemediation, isRemediationOverdue } from "./workflow";

let prisma: PrismaClient;
let directory: string;
const ids: Record<string, string> = {};
const who = (name: string, role: Role) => ({ id: ids[name], role });
const auditor = () => who("auditor", "AUDITOR");
const checker = () => who("checker", "AUDITOR");
const outsider = () => who("outsider", "AUDITOR");
const analyst = () => who("analyst", "SECURITY_ANALYST");
const admin = () => who("admin", "ADMINISTRATOR");
const viewer = () => who("viewer", "READ_ONLY_REVIEWER");

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "bankshield-findings-tests-"));
  const databasePath = path.join(directory, "findings.db");
  const sqlite = new Database(databasePath);
  const root = path.join(process.cwd(), "prisma", "migrations");
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    sqlite.exec(readFileSync(path.join(root, entry.name, "migration.sql"), "utf8"));
  }
  sqlite.close();
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) });
  for (const [name, role] of [
    ["admin", "ADMINISTRATOR"], ["auditor", "AUDITOR"], ["checker", "AUDITOR"], ["outsider", "AUDITOR"],
    ["analyst", "SECURITY_ANALYST"], ["viewer", "READ_ONLY_REVIEWER"],
  ] as const) {
    ids[name] = (await prisma.user.create({ data: { email: `${name}@example.test`, name, passwordHash: "test", role } })).id;
  }
});

after(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

const rand = () => Math.random().toString(36).slice(2, 9).toUpperCase();

async function fixture(status = "IN_PROGRESS") {
  const engagement = await prisma.auditEngagement.create({
    data: {
      title: "Findings test",
      auditedOrganization: "Fixture Bank",
      scope: "Synthetic scope.",
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-02-01T00:00:00.000Z"),
      status,
      createdById: ids.auditor,
      members: { create: [{ userId: ids.auditor }, { userId: ids.checker }, { userId: ids.analyst }] },
    },
    select: { id: true },
  });
  const document = await prisma.regulatoryDocument.create({
    data: {
      code: `FD-${rand()}`, title: "Fixture", issuer: "Test", sourceUrl: "https://authority.example.test/x",
      kind: "MANDATORY_LAW", language: "az",
      versions: { create: { versionLabel: "v1", sourceUrl: "https://authority.example.test/x" } },
    },
    select: { versions: { select: { id: true } } },
  });
  const requirement = await prisma.regulatoryRequirement.create({ data: { versionId: document.versions[0].id, clauseId: "1.1" }, select: { id: true } });
  await prisma.auditRequirementSelection.create({
    data: { engagementId: engagement.id, requirementId: requirement.id, selectedById: ids.auditor, verificationStatusAtSelection: "VERIFIED" },
  });
  return { engagementId: engagement.id, requirementId: requirement.id };
}

const findingInput = (engagementId: string, overrides: Record<string, unknown> = {}) => ({
  engagementId,
  title: "Privileged access is not reviewed",
  description: "Quarterly privileged access reviews were not performed in the audit period.",
  severity: "HIGH",
  requirementId: null,
  inherentLikelihood: 4,
  inherentImpact: 4,
  residualLikelihood: null,
  residualImpact: null,
  ...overrides,
});

const future = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
const actionInput = (findingId: string, overrides: Record<string, unknown> = {}) => ({
  findingId, ownerName: "IT Security", actionPlan: "Introduce a quarterly access review procedure.", dueDate: future, ...overrides,
});

async function stamp(findingId: string) {
  return (await prisma.auditFinding.findUniqueOrThrow({ where: { id: findingId } })).updatedAt.getTime();
}
const move = async (actor: { id: string; role: Role }, findingId: string, targetStatus: string, note = "") =>
  transitionFinding(prisma, actor, findingId, { targetStatus, expectedUpdatedAt: await stamp(findingId), note });

// Drives a finding through remediation up to READY_FOR_REVIEW.
async function readyFinding(overrides: Record<string, unknown> = {}) {
  const { engagementId, requirementId } = await fixture();
  const finding = await createFinding(prisma, auditor(), findingInput(engagementId, overrides));
  const action = await addRemediationAction(prisma, auditor(), actionInput(finding.id));
  await move(auditor(), finding.id, "IN_REMEDIATION");
  await updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "IN_PROGRESS" });
  await updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "COMPLETED" });
  await move(auditor(), finding.id, "READY_FOR_REVIEW");
  return { engagementId, requirementId, findingId: finding.id, actionId: action.id };
}

test("workflow transition tables", () => {
  assert.equal(canTransitionFinding("OPEN", "IN_REMEDIATION"), true);
  assert.equal(canTransitionFinding("OPEN", "CLOSED"), false);
  assert.equal(canTransitionFinding("CLOSED", "OPEN"), false);
  assert.equal(canTransitionFinding("READY_FOR_REVIEW", "IN_REMEDIATION"), true);
  assert.equal(canTransitionRemediation("OPEN", "VERIFIED"), false);
  assert.equal(canTransitionRemediation("COMPLETED", "VERIFIED"), true);
  assert.equal(canTransitionRemediation("VERIFIED", "IN_PROGRESS"), false);
  const due = new Date("2026-01-01T00:00:00Z");
  assert.equal(isRemediationOverdue({ status: "OPEN", dueDate: due }, new Date("2026-02-01T00:00:00Z")), true);
  assert.equal(isRemediationOverdue({ status: "VERIFIED", dueDate: due }, new Date("2026-02-01T00:00:00Z")), false);
});

test("creates a finding with history and audit trail, and validates input", async () => {
  const { engagementId, requirementId } = await fixture();
  const created = await createFinding(prisma, auditor(), findingInput(engagementId, { requirementId }));
  const row = await prisma.auditFinding.findUniqueOrThrow({ where: { id: created.id }, include: { history: true } });
  assert.equal(row.status, "OPEN");
  assert.equal(row.createdById, ids.auditor);
  assert.equal(row.history.length, 1);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: created.id, action: "FINDING_CREATED" } }), 1);

  await assert.rejects(() => createFinding(prisma, auditor(), findingInput(engagementId, { severity: "SEVERE" })), ZodError);
  await assert.rejects(() => createFinding(prisma, auditor(), findingInput(engagementId, { title: "x" })), ZodError);
  await assert.rejects(() => createFinding(prisma, auditor(), findingInput(engagementId, { inherentImpact: null })), ZodError);
  await assert.rejects(
    () => createFinding(prisma, auditor(), findingInput(engagementId, { residualLikelihood: 5, residualImpact: 5 })),
    ZodError,
  );
  await assert.rejects(() => createFinding(prisma, auditor(), findingInput(engagementId, { inherentLikelihood: 9 })), ZodError);
});

test("enforces permissions, engagement access and engagement locks", async () => {
  const { engagementId } = await fixture();
  await assert.rejects(() => createFinding(prisma, analyst(), findingInput(engagementId)), PermissionDeniedError);
  await assert.rejects(() => createFinding(prisma, viewer(), findingInput(engagementId)), PermissionDeniedError);
  await assert.rejects(() => createFinding(prisma, outsider(), findingInput(engagementId)), FindingNotFoundError);
  assert.ok((await createFinding(prisma, admin(), findingInput(engagementId))).id);

  const { engagementId: draftId } = await fixture("DRAFT");
  await assert.rejects(() => createFinding(prisma, auditor(), findingInput(draftId)), EngagementLockedError);
  const { engagementId: approvedId } = await fixture("APPROVED");
  await assert.rejects(() => createFinding(prisma, auditor(), findingInput(approvedId)), EngagementLockedError);

  // A requirement outside the engagement scope is rejected.
  const other = await fixture();
  await assert.rejects(
    () => createFinding(prisma, auditor(), findingInput(engagementId, { requirementId: other.requirementId })),
    FindingNotFoundError,
  );
});

test("update uses optimistic concurrency and is blocked once ready for review", async () => {
  const { engagementId } = await fixture();
  const finding = await createFinding(prisma, auditor(), findingInput(engagementId));
  const stale = await stamp(finding.id);
  await updateFinding(prisma, auditor(), finding.id, { ...findingInput(engagementId, { title: "Updated title" }), expectedUpdatedAt: stale });
  await assert.rejects(
    () => updateFinding(prisma, auditor(), finding.id, { ...findingInput(engagementId, { title: "Second writer" }), expectedUpdatedAt: stale }),
    StaleFindingError,
  );
  assert.equal((await prisma.auditFinding.findUniqueOrThrow({ where: { id: finding.id } })).title, "Updated title");
  assert.equal(await prisma.auditFindingHistory.count({ where: { findingId: finding.id } }), 2);

  const ready = await readyFinding();
  await assert.rejects(
    () => updateFinding(prisma, auditor(), ready.findingId, { ...findingInput(ready.engagementId), expectedUpdatedAt: 0 }),
    StaleFindingError,
  );
  await assert.rejects(
    async () => updateFinding(prisma, auditor(), ready.findingId, { ...findingInput(ready.engagementId), expectedUpdatedAt: await stamp(ready.findingId) }),
    FindingLockedError,
  );
});

test("status rules: actions are required, completion is required, closure needs verification and an independent closer", async () => {
  const { engagementId } = await fixture();
  const finding = await createFinding(prisma, auditor(), findingInput(engagementId));
  await assert.rejects(() => move(auditor(), finding.id, "IN_REMEDIATION"), (e) => e instanceof FindingRuleError && e.rule === "needsAction");
  await assert.rejects(() => move(auditor(), finding.id, "CLOSED", "closing now"), InvalidFindingTransitionError);

  const action = await addRemediationAction(prisma, auditor(), actionInput(finding.id));
  await move(auditor(), finding.id, "IN_REMEDIATION");
  await assert.rejects(() => move(auditor(), finding.id, "READY_FOR_REVIEW"), (e) => e instanceof FindingRuleError && e.rule === "actionsIncomplete");
  await assert.rejects(() => updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "COMPLETED" }), InvalidFindingTransitionError);
  await updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "IN_PROGRESS" });
  await updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "COMPLETED" });
  await move(auditor(), finding.id, "READY_FOR_REVIEW");
  await assert.rejects(() => move(auditor(), finding.id, "CLOSED", "all good here"), (e) => e instanceof FindingRuleError && e.rule === "actionsUnverified");

  // The analyst cannot verify; the creator can verify but cannot close; a different auditor closes.
  await assert.rejects(() => updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "VERIFIED" }), PermissionDeniedError);
  await updateRemediationStatus(prisma, checker(), { actionId: action.id, targetStatus: "VERIFIED" });
  await assert.rejects(() => move(auditor(), finding.id, "CLOSED", "closing my own"), (e) => e instanceof FindingRuleError && e.rule === "independentClosure");
  await assert.rejects(() => move(checker(), finding.id, "CLOSED", "ok"), (e) => e instanceof FindingRuleError && e.rule === "needsNote");
  await move(checker(), finding.id, "CLOSED", "Verified remediation evidence.");

  const closed = await prisma.auditFinding.findUniqueOrThrow({ where: { id: finding.id } });
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.approvedById, ids.checker);
  assert.ok(closed.approvedAt);
  await assert.rejects(() => move(checker(), finding.id, "OPEN"), InvalidFindingTransitionError);
  await assert.rejects(() => addRemediationAction(prisma, auditor(), actionInput(finding.id)), FindingLockedError);
});

test("reviewer can send a finding back to remediation with a note, and stale transitions fail", async () => {
  const ready = await readyFinding();
  await assert.rejects(() => move(checker(), ready.findingId, "IN_REMEDIATION"), (e) => e instanceof FindingRuleError && e.rule === "needsNote");
  const stamped = await stamp(ready.findingId);
  await move(checker(), ready.findingId, "IN_REMEDIATION", "Evidence is insufficient.");
  await assert.rejects(
    () => transitionFinding(prisma, checker(), ready.findingId, { targetStatus: "READY_FOR_REVIEW", expectedUpdatedAt: stamped, note: "" }),
    StaleFindingError,
  );
  // The completed action can be reopened while the finding is back in remediation.
  await updateRemediationStatus(prisma, analyst(), { actionId: ready.actionId, targetStatus: "IN_PROGRESS" });
  const action = await prisma.remediationAction.findUniqueOrThrow({ where: { id: ready.actionId } });
  assert.equal(action.status, "IN_PROGRESS");
  assert.equal(action.completedAt, null);
});

test("remediation actions: validation, completion evidence, owner cannot verify, locked statuses", async () => {
  const { engagementId } = await fixture();
  const finding = await createFinding(prisma, auditor(), findingInput(engagementId));
  await assert.rejects(() => addRemediationAction(prisma, auditor(), actionInput(finding.id, { actionPlan: "short" })), ZodError);
  await assert.rejects(() => addRemediationAction(prisma, auditor(), actionInput(finding.id, { dueDate: "2026-13-45" })), ZodError);
  await assert.rejects(() => addRemediationAction(prisma, analyst(), actionInput(finding.id)), PermissionDeniedError);
  await assert.rejects(() => addRemediationAction(prisma, outsider(), actionInput(finding.id)), FindingNotFoundError);

  const action = await addRemediationAction(prisma, auditor(), actionInput(finding.id));
  // Action work is not possible until the finding is in remediation.
  await assert.rejects(() => updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "IN_PROGRESS" }), FindingLockedError);
});

test("completion evidence must belong to the engagement and be usable", async () => {
  const { engagementId } = await fixture();
  const finding = await createFinding(prisma, auditor(), findingInput(engagementId));
  const action = await addRemediationAction(prisma, auditor(), actionInput(finding.id));
  await move(auditor(), finding.id, "IN_REMEDIATION");
  await updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "IN_PROGRESS" });

  const makeEvidence = (engagement: string, reviewStatus: string) =>
    prisma.evidenceDocument.create({
      data: {
        engagementId: engagement, originalName: "proof.pdf", storageKey: `k-${rand()}${rand()}`, mimeType: "application/pdf",
        sizeBytes: 10, sha256: "0".repeat(64), uploadedById: ids.analyst, reviewStatus,
      },
    });
  const rejected = await makeEvidence(engagementId, "REJECTED");
  const foreign = await makeEvidence((await fixture()).engagementId, "ACCEPTED");
  for (const bad of [rejected.id, foreign.id, "missing"]) {
    await assert.rejects(
      () => updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "COMPLETED", completionEvidenceId: bad }),
      (e) => e instanceof FindingRuleError && e.rule === "invalidEvidence",
    );
  }
  const good = await makeEvidence(engagementId, "ACCEPTED");
  await updateRemediationStatus(prisma, analyst(), { actionId: action.id, targetStatus: "COMPLETED", completionEvidenceId: good.id });
  const saved = await prisma.remediationAction.findUniqueOrThrow({ where: { id: action.id } });
  assert.equal(saved.completionEvidenceId, good.id);
  assert.ok(saved.completedAt);
});

test("owner cannot verify their own action", async () => {
  const ready = await readyFinding();
  await prisma.remediationAction.update({ where: { id: ready.actionId }, data: { ownerUserId: ids.checker } });
  await assert.rejects(
    () => updateRemediationStatus(prisma, checker(), { actionId: ready.actionId, targetStatus: "VERIFIED" }),
    (e) => e instanceof FindingRuleError && e.rule === "ownerCannotVerify",
  );
  await updateRemediationStatus(prisma, admin(), { actionId: ready.actionId, targetStatus: "VERIFIED" });
});

test("scoped queries, filters, overdue counts and summaries", async () => {
  const mine = await fixture();
  const finding = await createFinding(prisma, auditor(), findingInput(mine.engagementId, { title: "Scoped finding alpha", severity: "CRITICAL" }));
  const action = await addRemediationAction(prisma, auditor(), actionInput(finding.id));
  await prisma.remediationAction.update({ where: { id: action.id }, data: { dueDate: new Date("2020-01-01T00:00:00Z") } });

  const mineList = await getFindingList(prisma, auditor(), normalizeFindingFilters({ q: "alpha" }));
  assert.equal(mineList.length, 1);
  assert.equal(mineList[0].overdueActions, 1);
  assert.equal((await getFindingList(prisma, outsider(), normalizeFindingFilters({ q: "alpha" }))).length, 0);
  assert.equal((await getFindingList(prisma, admin(), normalizeFindingFilters({ q: "alpha" }))).length, 1);
  assert.equal((await getFindingList(prisma, auditor(), normalizeFindingFilters({ q: "alpha", severity: "LOW" }))).length, 0);
  assert.equal(await getFindingDetails(prisma, outsider(), finding.id), null);
  const detail = await getFindingDetails(prisma, auditor(), finding.id);
  assert.equal(detail?.actions[0].overdue, true);
  assert.equal(detail?.inherentScore, 16);

  const summary = summarizeFindings(mineList);
  assert.equal(summary.open, 1);
  assert.equal(summary.severities.CRITICAL, 1);
  assert.equal(summary.overdueActions, 1);
  assert.deepEqual(normalizeFindingFilters({ status: ["bogus"], severity: "nope", q: ["a", "b"] }), { search: "a", status: "ALL", severity: "ALL" });
});

test("the create-finding form gets each engagement's selected requirements and can link one on create", async () => {
  const mine = await fixture();
  const options = await getFindingEngagements(prisma, { id: ids.auditor, role: "AUDITOR" });
  const entry = options.find((option) => option.id === mine.engagementId);
  assert.ok(entry, "the engagement is offered");
  assert.deepEqual(entry.requirements.map((requirement) => requirement.id), [mine.requirementId]);
  assert.ok(!("requirementSelections" in entry));
  // A requirement taken from that list is accepted; one from another engagement is not.
  const linked = await createFinding(prisma, auditor(), findingInput(mine.engagementId, { requirementId: mine.requirementId }));
  assert.equal((await prisma.auditFinding.findUniqueOrThrow({ where: { id: linked.id } })).requirementId, mine.requirementId);
  const other = await fixture();
  await assert.rejects(createFinding(prisma, auditor(), findingInput(mine.engagementId, { requirementId: other.requirementId })));
});
