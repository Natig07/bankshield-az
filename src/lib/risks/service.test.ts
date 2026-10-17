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
import { getRiskDetails, getRiskList, normalizeRiskFilters, scoreRisk, summarizeRisks } from "./data";
import {
  createAsset,
  createRisk,
  createTreatmentAction,
  DuplicateRiskRecordError,
  InvalidRiskAssetError,
  InvalidRiskTransitionError,
  linkRiskControl,
  RiskLockedError,
  RiskNotFoundError,
  RiskTransitionRuleError,
  StaleRiskError,
  transitionRisk,
  unlinkRiskControl,
  updateAsset,
  updateRisk,
  updateTreatmentActionStatus,
} from "./service";
import { canTransitionRisk, canTransitionTreatmentAction } from "./workflow";

let prisma: PrismaClient;
let directory: string;
const admin = { id: "admin-1", role: "ADMINISTRATOR" as Role };
const analyst = { id: "analyst-1", role: "SECURITY_ANALYST" as Role };
const auditor = { id: "auditor-1", role: "AUDITOR" as Role };
const viewer = { id: "viewer-1", role: "READ_ONLY_REVIEWER" as Role };

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "bankshield-risk-tests-"));
  const databasePath = path.join(directory, "risk.db");
  const sqlite = new Database(databasePath);
  const root = path.join(process.cwd(), "prisma", "migrations");
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    sqlite.exec(readFileSync(path.join(root, entry.name, "migration.sql"), "utf8"));
  }
  sqlite.close();
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) });
  // AuditEvent.actorId is a real foreign key, so the actors must exist as users.
  for (const [actor, role] of [[admin, "ADMINISTRATOR"], [analyst, "SECURITY_ANALYST"], [auditor, "AUDITOR"], [viewer, "READ_ONLY_REVIEWER"]] as const) {
    await prisma.user.create({ data: { id: actor.id, email: `${actor.id}@example.test`, name: actor.id, passwordHash: "test", role } });
  }
});

after(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

const future = () => {
  const date = new Date(Date.now() + 90 * 86_400_000);
  return date.toISOString().slice(0, 10);
};
const past = "2020-01-01";

const riskInput = (overrides: Record<string, unknown> = {}) => ({
  title: "Privileged accounts lack MFA",
  description: "Administrative accounts on core banking can log in with a password only.",
  category: "ACCESS_CONTROL",
  assetId: null,
  ownerName: "Head of IT Security",
  inherentLikelihood: 4,
  inherentImpact: 5,
  residualLikelihood: null,
  residualImpact: null,
  treatment: "MITIGATE",
  reviewDate: null,
  ...overrides,
});

async function newRisk(overrides: Record<string, unknown> = {}) {
  const created = await createRisk(prisma, analyst, riskInput(overrides));
  const row = await prisma.risk.findUniqueOrThrow({ where: { id: created.id } });
  return { id: created.id, revision: row.revision };
}

async function addAction(riskId: string, dueDate = future()) {
  return createTreatmentAction(prisma, analyst, {
    riskId,
    title: "Roll out hardware tokens",
    description: null,
    ownerName: "IT Operations",
    dueDate,
  });
}

test("authorization: only risk managers write, only administrators accept, everyone with access reads", async () => {
  await assert.rejects(createRisk(prisma, viewer, riskInput()), PermissionDeniedError);
  await assert.rejects(createRisk(prisma, auditor, riskInput()), PermissionDeniedError);
  await assert.rejects(createAsset(prisma, auditor, { code: "A-1", name: "Core", assetType: "APPLICATION", criticality: "HIGH", ownerName: "Ops", description: null }), PermissionDeniedError);
  const risk = await newRisk({ residualLikelihood: 2, residualImpact: 2, reviewDate: future() });
  await assert.rejects(
    transitionRisk(prisma, analyst, risk.id, { targetStatus: "ACCEPTED", expectedRevision: risk.revision, note: "", acceptanceJustification: "Business accepts this exposure." }),
    PermissionDeniedError,
  );
  assert.equal((await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } })).status, "OPEN");
});

test("risk creation validates scores, residual rules, assets and generates unique codes with history and audit events", async () => {
  for (const bad of [
    { inherentLikelihood: 0 },
    { inherentImpact: 6 },
    { inherentLikelihood: 2.5 },
    { title: "ab" },
    { description: "too short" },
    { category: "NOT_A_CATEGORY" },
    { residualLikelihood: 2 }, // residual must be provided as a pair
    { residualLikelihood: 5, residualImpact: 5 }, // residual 25 > inherent 20
    { reviewDate: "2026-02-31" },
  ]) {
    await assert.rejects(createRisk(prisma, analyst, riskInput(bad)), ZodError, JSON.stringify(bad));
  }
  await assert.rejects(createRisk(prisma, analyst, riskInput({ assetId: "missing" })), InvalidRiskAssetError);

  const first = await createRisk(prisma, analyst, riskInput());
  const second = await createRisk(prisma, analyst, riskInput({ title: "Second risk title" }));
  assert.match(first.code, /^RSK-\d{4}$/);
  assert.notEqual(first.code, second.code);
  assert.equal(await prisma.riskHistory.count({ where: { riskId: first.id, revision: 1 } }), 1);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: first.id, action: "RISK_CREATED" } }), 1);

  const asset = await createAsset(prisma, analyst, { code: " core-1 ", name: "Core banking", assetType: "APPLICATION", criticality: "CRITICAL", ownerName: "Head of IT", description: null });
  await assert.rejects(createAsset(prisma, analyst, { code: "CORE-1", name: "Duplicate", assetType: "DATA", criticality: "LOW", ownerName: "Ops", description: null }), DuplicateRiskRecordError);
  await createRisk(prisma, analyst, riskInput({ assetId: asset.id }));
  await updateAsset(prisma, analyst, asset.id, { code: "CORE-1", name: "Core banking", assetType: "APPLICATION", criticality: "CRITICAL", ownerName: "Head of IT", description: null, isActive: false });
  await assert.rejects(createRisk(prisma, analyst, riskInput({ assetId: asset.id })), InvalidRiskAssetError);
  await assert.rejects(updateAsset(prisma, analyst, "missing", { code: "X-1", name: "Missing", assetType: "DATA", criticality: "LOW", ownerName: "Ops", description: null }), RiskNotFoundError);
});

test("scores are derived from inputs, never stored, and use residual only once assessed", async () => {
  assert.deepEqual(scoreRisk({ inherentLikelihood: 4, inherentImpact: 5, residualLikelihood: null, residualImpact: null }), {
    inherentScore: 20, inherentBand: "CRITICAL", residualScore: null, residualBand: null, currentScore: 20, currentBand: "CRITICAL", currentBasis: "INHERENT",
  });
  const scored = scoreRisk({ inherentLikelihood: 4, inherentImpact: 5, residualLikelihood: 2, residualImpact: 2 });
  assert.equal(scored.currentScore, 4);
  assert.equal(scored.currentBand, "LOW");
  assert.equal(scored.currentBasis, "RESIDUAL");
  const risk = await newRisk();
  const row = await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } });
  assert.equal("score" in row, false);
});

test("edits need the current revision, bump it, record history, and are blocked unless the risk is open or in treatment", async () => {
  const risk = await newRisk();
  const edit = { ...riskInput({ title: "Privileged accounts lack MFA (updated)" }), expectedRevision: risk.revision };
  const updated = await updateRisk(prisma, analyst, risk.id, edit);
  assert.equal(updated.revision, risk.revision + 1);
  await assert.rejects(updateRisk(prisma, analyst, risk.id, edit), StaleRiskError);
  await assert.rejects(updateRisk(prisma, analyst, risk.id, { ...riskInput(), expectedRevision: 0 }), ZodError);
  await assert.rejects(updateRisk(prisma, analyst, "missing", edit), RiskNotFoundError);
  assert.equal(await prisma.riskHistory.count({ where: { riskId: risk.id } }), 2);
  assert.equal((await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } })).title, "Privileged accounts lack MFA (updated)");

  await transitionRisk(prisma, analyst, risk.id, { targetStatus: "CLOSED", expectedRevision: updated.revision, note: "Duplicate of another entry." });
  await assert.rejects(updateRisk(prisma, analyst, risk.id, { ...riskInput(), expectedRevision: updated.revision + 1 }), RiskLockedError);

  // Two editors holding the same revision: exactly one wins.
  const contested = await newRisk();
  const outcomes = await Promise.allSettled([
    updateRisk(prisma, analyst, contested.id, { ...riskInput({ title: "Editor one title" }), expectedRevision: contested.revision }),
    updateRisk(prisma, admin, contested.id, { ...riskInput({ title: "Editor two title" }), expectedRevision: contested.revision }),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  const loser = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(loser && loser.status === "rejected" && loser.reason instanceof StaleRiskError);
});

test("status transitions enforce treatment, action, justification, residual, review-date and closure rules", async () => {
  assert.equal(canTransitionRisk("OPEN", "IN_TREATMENT"), true);
  assert.equal(canTransitionRisk("CLOSED", "ACCEPTED"), false);
  assert.equal(canTransitionRisk("CLOSED", "OPEN"), true);
  assert.equal(canTransitionRisk("OPEN", "NOT_A_STATUS"), false);

  const risk = await newRisk();
  const go = (who: typeof admin, revision: number, targetStatus: string, extra: Record<string, unknown> = {}) =>
    transitionRisk(prisma, who, risk.id, { targetStatus, expectedRevision: revision, note: "", ...extra });

  await assert.rejects(go(analyst, risk.revision, "IN_TREATMENT"), (error) => error instanceof RiskTransitionRuleError && error.rule === "needsAction");
  const action = await addAction(risk.id);
  const inTreatment = await go(analyst, risk.revision, "IN_TREATMENT");
  await assert.rejects(go(analyst, risk.revision, "OPEN", { note: "stale" }), StaleRiskError);
  await assert.rejects(go(analyst, inTreatment.revision, "CLOSED", { note: "Done with it." }), (error) => error instanceof RiskTransitionRuleError && error.rule === "openActions");
  await updateTreatmentActionStatus(prisma, analyst, { actionId: action.id, targetStatus: "DONE" });

  // Acceptance: administrator only, justification, residual assessment and a future review date.
  await assert.rejects(go(admin, inTreatment.revision, "ACCEPTED", { acceptanceJustification: "short" }), (error) => error instanceof RiskTransitionRuleError && error.rule === "needsJustification");
  await assert.rejects(go(admin, inTreatment.revision, "ACCEPTED", { acceptanceJustification: "Exposure tolerated by management." }), (error) => error instanceof RiskTransitionRuleError && error.rule === "needsResidual");
  const assessed = await updateRisk(prisma, analyst, risk.id, { ...riskInput({ residualLikelihood: 2, residualImpact: 3, reviewDate: past }), expectedRevision: inTreatment.revision });
  await assert.rejects(go(admin, assessed.revision, "ACCEPTED", { acceptanceJustification: "Exposure tolerated by management." }), (error) => error instanceof RiskTransitionRuleError && error.rule === "needsReviewDate");
  const dated = await updateRisk(prisma, analyst, risk.id, { ...riskInput({ residualLikelihood: 2, residualImpact: 3, reviewDate: future() }), expectedRevision: assessed.revision });
  const accepted = await go(admin, dated.revision, "ACCEPTED", { acceptanceJustification: "Exposure tolerated by management." });
  const row = await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } });
  assert.equal(row.status, "ACCEPTED");
  assert.equal(row.treatment, "ACCEPT");
  assert.equal(row.acceptedById, admin.id);
  assert.ok(row.acceptedAt);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: risk.id, action: "RISK_ACCEPTED" } }), 1);

  // An accepted risk cannot be edited in place; reopening withdraws the acceptance but keeps history.
  await assert.rejects(updateRisk(prisma, analyst, risk.id, { ...riskInput(), expectedRevision: accepted.revision }), RiskLockedError);
  await assert.rejects(go(analyst, accepted.revision, "OPEN"), (error) => error instanceof RiskTransitionRuleError && error.rule === "needsNote");
  const reopened = await go(analyst, accepted.revision, "OPEN", { note: "Control environment changed." });
  const reopenedRow = await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } });
  assert.equal(reopenedRow.acceptedById, null);
  assert.equal(reopenedRow.acceptanceJustification, null);
  const history = await prisma.riskHistory.findMany({ where: { riskId: risk.id }, orderBy: { revision: "asc" } });
  assert.equal(history.length, reopened.revision);
  assert.ok(history.some(({ snapshot }) => JSON.parse(snapshot).acceptedById === admin.id));

  const closed = await go(analyst, reopened.revision, "CLOSED", { note: "Risk retired after migration." });
  await assert.rejects(go(analyst, closed.revision, "IN_TREATMENT"), InvalidRiskTransitionError);
});

test("treatment actions follow their own lifecycle and are locked on closed risks", async () => {
  assert.equal(canTransitionTreatmentAction("OPEN", "DONE"), true);
  assert.equal(canTransitionTreatmentAction("DONE", "OPEN"), false);
  const risk = await newRisk();
  await assert.rejects(createTreatmentAction(prisma, analyst, { riskId: risk.id, title: "ab", description: null, ownerName: "Ops", dueDate: future() }), ZodError);
  await assert.rejects(createTreatmentAction(prisma, analyst, { riskId: "missing", title: "Valid title", description: null, ownerName: "Ops", dueDate: future() }), RiskNotFoundError);
  const action = await addAction(risk.id);
  await updateTreatmentActionStatus(prisma, analyst, { actionId: action.id, targetStatus: "IN_PROGRESS" });
  await updateTreatmentActionStatus(prisma, analyst, { actionId: action.id, targetStatus: "DONE" });
  const done = await prisma.riskTreatmentAction.findUniqueOrThrow({ where: { id: action.id } });
  assert.ok(done.completedAt);
  await assert.rejects(updateTreatmentActionStatus(prisma, analyst, { actionId: action.id, targetStatus: "OPEN" }), InvalidRiskTransitionError);
  await assert.rejects(updateTreatmentActionStatus(prisma, auditor, { actionId: action.id, targetStatus: "CANCELLED" }), PermissionDeniedError);
  await transitionRisk(prisma, analyst, risk.id, { targetStatus: "CLOSED", expectedRevision: risk.revision, note: "No longer applicable." });
  await assert.rejects(addAction(risk.id), RiskLockedError);
});

test("control links are unique, reversible while editable, and audited", async () => {
  const risk = await newRisk();
  const control = await prisma.cybersecurityControl.create({ data: { code: "RISK-CTL-1", title: "Privileged access management" } });
  await linkRiskControl(prisma, analyst, { riskId: risk.id, controlId: control.id });
  await assert.rejects(linkRiskControl(prisma, analyst, { riskId: risk.id, controlId: control.id }), DuplicateRiskRecordError);
  await assert.rejects(linkRiskControl(prisma, analyst, { riskId: risk.id, controlId: "missing" }), RiskNotFoundError);
  assert.equal((await getRiskDetails(prisma, risk.id))?.controls.length, 1);
  await unlinkRiskControl(prisma, analyst, { riskId: risk.id, controlId: control.id });
  await assert.rejects(unlinkRiskControl(prisma, analyst, { riskId: risk.id, controlId: control.id }), RiskNotFoundError);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: risk.id, action: { in: ["RISK_CONTROL_LINKED", "RISK_CONTROL_UNLINKED"] } } }), 2);
});

test("risk list filters, sorts by current severity, counts overdue actions and summarises honestly", async () => {
  const empty = await getRiskList(prisma, normalizeRiskFilters({ q: "no-such-risk-anywhere" }));
  assert.deepEqual(empty, []);
  assert.deepEqual(summarizeRisks(empty), { active: 0, bands: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }, overdueActions: 0 });

  const low = await newRisk({ title: "Zebra low risk", inherentLikelihood: 1, inherentImpact: 2, category: "NETWORK" });
  const overdue = await newRisk({ title: "Zebra critical risk", inherentLikelihood: 5, inherentImpact: 5, category: "NETWORK" });
  await prisma.riskTreatmentAction.create({ data: { riskId: overdue.id, title: "Late action", ownerName: "Ops", dueDate: new Date("2020-01-01T00:00:00.000Z"), createdById: analyst.id } });
  await prisma.riskTreatmentAction.create({ data: { riskId: overdue.id, title: "Finished", ownerName: "Ops", dueDate: new Date("2020-01-01T00:00:00.000Z"), status: "DONE", createdById: analyst.id } });

  const list = await getRiskList(prisma, normalizeRiskFilters({ q: "zebra" }));
  assert.deepEqual(list.map(({ id }) => id), [overdue.id, low.id]);
  assert.equal(list[0].overdueActions, 1);
  assert.equal(list[0].openActions, 1);
  assert.equal(list[0].currentBand, "CRITICAL");
  assert.equal((await getRiskList(prisma, normalizeRiskFilters({ q: "zebra", band: "LOW" }))).length, 1);
  assert.equal((await getRiskList(prisma, normalizeRiskFilters({ q: "zebra", category: "NETWORK", status: "CLOSED" }))).length, 0);
  assert.deepEqual(summarizeRisks(list), { active: 2, bands: { LOW: 1, MEDIUM: 0, HIGH: 0, CRITICAL: 1 }, overdueActions: 1 });
  assert.deepEqual(normalizeRiskFilters({ q: ["a", "b"], status: "BOGUS", band: ["HIGH"] }), { search: "a", status: "ALL", category: "ALL", band: "HIGH" });
});
