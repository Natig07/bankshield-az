import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { ZodError } from "zod";
import { PrismaClient } from "@/generated/prisma/client";
import { PermissionDeniedError, type Role } from "@/lib/auth/authorization";
import { EngagementLockedError } from "@/lib/audits/service";
import { getEvidenceList } from "./data";
import {
  DuplicateEvidenceError,
  EvidenceIntegrityError,
  EvidenceNotFoundError,
  EvidenceReviewStateError,
  IndependentEvidenceReviewError,
  InvalidEvidenceScopeError,
  readEvidenceForDownload,
  reviewEvidence,
  uploadEvidence,
} from "./service";
import { openEvidenceStorage, type EvidenceStorage } from "./storage";
import { EvidenceValidationError } from "./validation";

let prisma: PrismaClient;
let directory: string;
let storage: EvidenceStorage;
let adminId: string;
let auditorId: string;
let outsiderAuditorId: string;
let analystId: string;
let outsiderAnalystId: string;
let viewerId: string;

const actor = (id: string, role: Role) => ({ id, role });
const pdf = (text: string) => Buffer.from(`%PDF-1.7\n${text}\n%%EOF`);

function storedFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    );
  return walk(storage.root);
}

before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "bankshield-evidence-tests-"));
  const databasePath = path.join(directory, "evidence.db");
  const sqlite = new Database(databasePath);
  const root = path.join(process.cwd(), "prisma", "migrations");
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    sqlite.exec(readFileSync(path.join(root, entry.name, "migration.sql"), "utf8"));
  }
  sqlite.close();
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) });
  storage = await openEvidenceStorage("store", directory);
  const make = (name: string, role: Role) =>
    prisma.user.create({ data: { email: `${name}@example.test`, name, passwordHash: "test", role } });
  const users = await Promise.all([
    make("admin", "ADMINISTRATOR"),
    make("auditor", "AUDITOR"),
    make("outsider-auditor", "AUDITOR"),
    make("analyst", "SECURITY_ANALYST"),
    make("outsider-analyst", "SECURITY_ANALYST"),
    make("viewer", "READ_ONLY_REVIEWER"),
  ]);
  [adminId, auditorId, outsiderAuditorId, analystId, outsiderAnalystId, viewerId] = users.map(({ id }) => id);
});

after(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

async function fixture(status = "IN_PROGRESS") {
  const engagement = await prisma.auditEngagement.create({
    data: {
      title: "Evidence test",
      auditedOrganization: "Fixture Bank",
      scope: "Synthetic scope.",
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-02-01T00:00:00.000Z"),
      status,
      createdById: auditorId,
      members: { create: [{ userId: auditorId }, { userId: analystId }] },
    },
    select: { id: true },
  });
  const control = await prisma.cybersecurityControl.create({
    data: { code: `EV-${Math.random().toString(36).slice(2, 9).toUpperCase()}`, title: "Evidence control" },
  });
  const document = await prisma.regulatoryDocument.create({
    data: {
      code: `EVDOC-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      title: "Fixture",
      issuer: "Test",
      sourceUrl: "https://authority.example.test/x",
      kind: "MANDATORY_LAW",
      language: "az",
      versions: { create: { versionLabel: "v1", sourceUrl: "https://authority.example.test/x" } },
    },
    select: { versions: { select: { id: true } } },
  });
  const requirement = await prisma.regulatoryRequirement.create({
    data: { versionId: document.versions[0].id, clauseId: "1.1" },
    select: { id: true },
  });
  await prisma.auditScopeItem.create({
    data: { engagementId: engagement.id, controlId: control.id, requirementId: requirement.id },
  });
  return { engagementId: engagement.id, controlId: control.id };
}

const upload = (
  who: { id: string; role: Role },
  engagementId: string,
  bytes: Uint8Array,
  options: { name?: string; controlId?: string | null; replacesId?: string | null } = {},
) =>
  uploadEvidence(prisma, storage, who, {
    engagementId,
    controlId: options.controlId ?? null,
    replacesId: options.replacesId ?? null,
    fileName: options.name ?? "evidence.pdf",
    bytes,
  });

test("an engagement participant with evidence:manage uploads a file that is stored privately with a checksum and audit event", async () => {
  const { engagementId, controlId } = await fixture();
  const before = storedFiles().length;
  const bytes = pdf("upload happy path");
  const record = await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, bytes, { name: "../../policy.pdf", controlId });
  const row = await prisma.evidenceDocument.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(row.originalName, "policy.pdf");
  assert.equal(row.mimeType, "application/pdf");
  assert.equal(row.sizeBytes, bytes.length);
  assert.match(row.sha256, /^[a-f0-9]{64}$/);
  assert.match(row.storageKey, /^[a-f0-9]{64}$/);
  assert.notEqual(row.storageKey, "policy.pdf");
  assert.equal(row.uploadedById, analystId);
  assert.equal(row.reviewStatus, "PENDING_REVIEW");
  assert.equal(storedFiles().length, before + 1);
  assert.ok(storedFiles().some((file) => file.endsWith(row.storageKey)));
  assert.equal(await prisma.auditEvent.count({ where: { entityId: engagementId, action: "EVIDENCE_UPLOADED", outcome: "SUCCESS" } }), 1);
});

test("upload authorisation: role permission and engagement membership are both required, and denials leave no file or row", async () => {
  const { engagementId } = await fixture();
  const filesBefore = storedFiles().length;
  const rowsBefore = await prisma.evidenceDocument.count();
  await assert.rejects(upload(actor(viewerId, "READ_ONLY_REVIEWER"), engagementId, pdf("viewer")), PermissionDeniedError);
  await assert.rejects(upload(actor(auditorId, "AUDITOR"), engagementId, pdf("auditor")), PermissionDeniedError);
  await assert.rejects(upload(actor(outsiderAnalystId, "SECURITY_ANALYST"), engagementId, pdf("outsider")), EvidenceNotFoundError);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: engagementId, action: "EVIDENCE_UPLOAD_DENIED", outcome: "DENIED", actorId: outsiderAnalystId } }), 1);
  assert.equal(storedFiles().length, filesBefore);
  assert.equal(await prisma.evidenceDocument.count(), rowsBefore);
  await upload(actor(adminId, "ADMINISTRATOR"), engagementId, pdf("administrator can upload"));
});

test("invalid files are rejected before anything is stored", async () => {
  const { engagementId } = await fixture();
  const filesBefore = storedFiles().length;
  await assert.rejects(upload(actor(analystId, "SECURITY_ANALYST"), engagementId, Buffer.from("MZ"), { name: "tool.exe" }), EvidenceValidationError);
  await assert.rejects(upload(actor(analystId, "SECURITY_ANALYST"), engagementId, Buffer.alloc(0)), EvidenceValidationError);
  await assert.rejects(upload(actor(analystId, "SECURITY_ANALYST"), engagementId, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { name: "image.pdf" }), EvidenceValidationError);
  assert.equal(storedFiles().length, filesBefore);
});

test("engagement status, control scope and duplicates are enforced, and rolled-back uploads leave no orphan file", async () => {
  const { engagementId, controlId } = await fixture();
  const other = await fixture();
  const filesBefore = storedFiles().length;

  await assert.rejects(upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("wrong control"), { controlId: other.controlId }), InvalidEvidenceScopeError);
  await assert.rejects(upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("bad replace"), { replacesId: "missing" }), InvalidEvidenceScopeError);
  assert.equal(storedFiles().length, filesBefore);

  const first = await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("same bytes"), { controlId });
  assert.equal(storedFiles().length, filesBefore + 1);
  await assert.rejects(upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("same bytes"), { name: "renamed.pdf" }), DuplicateEvidenceError);
  assert.equal(storedFiles().length, filesBefore + 1);
  assert.equal(await prisma.evidenceDocument.count({ where: { engagementId } }), 1);
  assert.ok(first.id);

  for (const status of ["IN_REVIEW", "APPROVED", "ARCHIVED"]) {
    await prisma.auditEngagement.update({ where: { id: engagementId }, data: { status } });
    await assert.rejects(upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf(`locked ${status}`)), EngagementLockedError);
  }
  assert.equal(storedFiles().length, filesBefore + 1);
});

test("replacement supersedes the previous record and keeps the history", async () => {
  const { engagementId } = await fixture();
  const first = await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("version one"));
  const second = await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("version two"), { replacesId: first.id });
  const rows = await prisma.evidenceDocument.findMany({ where: { engagementId }, orderBy: { uploadedAt: "asc" } });
  assert.equal(rows.length, 2);
  assert.equal(rows.find(({ id }) => id === first.id)?.reviewStatus, "SUPERSEDED");
  assert.equal(rows.find(({ id }) => id === second.id)?.replacesId, first.id);
  await assert.rejects(upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("version three"), { replacesId: first.id }), InvalidEvidenceScopeError);
  assert.equal(storedFiles().filter((file) => file.length > 0).length >= 2, true);
});

test("review needs evidence:review, engagement access, independence from the uploader, and a pending record", async () => {
  const { engagementId } = await fixture();
  const uploaded = await upload(actor(adminId, "ADMINISTRATOR"), engagementId, pdf("review me"));

  await assert.rejects(reviewEvidence(prisma, actor(analystId, "SECURITY_ANALYST"), uploaded.id, { decision: "ACCEPTED", note: "" }), PermissionDeniedError);
  await assert.rejects(reviewEvidence(prisma, actor(viewerId, "READ_ONLY_REVIEWER"), uploaded.id, { decision: "ACCEPTED", note: "" }), PermissionDeniedError);
  await assert.rejects(reviewEvidence(prisma, actor(outsiderAuditorId, "AUDITOR"), uploaded.id, { decision: "ACCEPTED", note: "" }), EvidenceNotFoundError);
  await assert.rejects(reviewEvidence(prisma, actor(adminId, "ADMINISTRATOR"), uploaded.id, { decision: "ACCEPTED", note: "" }), IndependentEvidenceReviewError);
  await assert.rejects(reviewEvidence(prisma, actor(auditorId, "AUDITOR"), uploaded.id, { decision: "REJECTED", note: "no" }), ZodError);
  assert.equal((await prisma.evidenceDocument.findUniqueOrThrow({ where: { id: uploaded.id } })).reviewStatus, "PENDING_REVIEW");

  await reviewEvidence(prisma, actor(auditorId, "AUDITOR"), uploaded.id, { decision: "REJECTED", note: "Screenshot is unreadable." });
  const rejected = await prisma.evidenceDocument.findUniqueOrThrow({ where: { id: uploaded.id } });
  assert.equal(rejected.reviewStatus, "REJECTED");
  assert.equal(rejected.reviewedById, auditorId);
  assert.equal(rejected.reviewNote, "Screenshot is unreadable.");
  await assert.rejects(reviewEvidence(prisma, actor(auditorId, "AUDITOR"), uploaded.id, { decision: "ACCEPTED", note: "" }), EvidenceReviewStateError);

  const second = await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("second attempt"));
  await reviewEvidence(prisma, actor(auditorId, "AUDITOR"), second.id, { decision: "ACCEPTED", note: "" });
  assert.equal((await prisma.evidenceDocument.findUniqueOrThrow({ where: { id: second.id } })).reviewStatus, "ACCEPTED");
  await prisma.auditEngagement.update({ where: { id: engagementId }, data: { status: "ARCHIVED" } });
  const third = await prisma.evidenceDocument.create({
    data: { engagementId, originalName: "x.pdf", storageKey: "f".repeat(64), mimeType: "application/pdf", sizeBytes: 1, sha256: "b".repeat(64), uploadedById: analystId },
    select: { id: true },
  });
  await assert.rejects(reviewEvidence(prisma, actor(auditorId, "AUDITOR"), third.id, { decision: "ACCEPTED", note: "" }), EngagementLockedError);
});

test("download is limited to authorised engagement readers, verifies the checksum, and is audited", async () => {
  const { engagementId } = await fixture();
  const bytes = pdf("confidential content");
  const record = await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, bytes, { name: "résumé.pdf" });

  const served = await readEvidenceForDownload(prisma, storage, actor(auditorId, "AUDITOR"), record.id);
  assert.deepEqual(served.bytes, bytes);
  assert.equal(served.mimeType, "application/pdf");
  assert.equal(served.fileName, "résumé.pdf");
  assert.equal((await readEvidenceForDownload(prisma, storage, actor(adminId, "ADMINISTRATOR"), record.id)).bytes.length, bytes.length);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: record.id, action: "EVIDENCE_DOWNLOADED", outcome: "SUCCESS" } }), 2);

  // A user with the role permission but no access to this engagement gets the same answer as for a missing record.
  await assert.rejects(readEvidenceForDownload(prisma, storage, actor(outsiderAuditorId, "AUDITOR"), record.id), EvidenceNotFoundError);
  await assert.rejects(readEvidenceForDownload(prisma, storage, actor(viewerId, "READ_ONLY_REVIEWER"), record.id), EvidenceNotFoundError);
  await assert.rejects(readEvidenceForDownload(prisma, storage, actor(auditorId, "AUDITOR"), "does-not-exist"), EvidenceNotFoundError);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: record.id, action: "EVIDENCE_DOWNLOAD_DENIED", outcome: "DENIED" } }), 2);
});

test("download detects tampered and missing stored files", async () => {
  const { engagementId } = await fixture();
  const tampered = await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("original bytes"));
  const row = await prisma.evidenceDocument.findUniqueOrThrow({ where: { id: tampered.id } });
  const file = path.join(storage.root, row.storageKey.slice(0, 2), row.storageKey);
  writeFileSync(file, pdf("tampered bytes!"));
  await assert.rejects(readEvidenceForDownload(prisma, storage, actor(auditorId, "AUDITOR"), tampered.id), EvidenceIntegrityError);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: tampered.id, action: "EVIDENCE_INTEGRITY_FAILED", outcome: "FAILURE" } }), 1);

  const missing = await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("will be removed"));
  const missingRow = await prisma.evidenceDocument.findUniqueOrThrow({ where: { id: missing.id } });
  rmSync(path.join(storage.root, missingRow.storageKey.slice(0, 2), missingRow.storageKey));
  await assert.rejects(readEvidenceForDownload(prisma, storage, actor(auditorId, "AUDITOR"), missing.id), EvidenceNotFoundError);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: missing.id, action: "EVIDENCE_FILE_UNAVAILABLE", outcome: "FAILURE" } }), 1);

  // A row whose key was altered to escape the store is refused, not followed.
  const escaped = await prisma.evidenceDocument.create({
    data: { engagementId, originalName: "x.pdf", storageKey: "../../etc/passwd", mimeType: "application/pdf", sizeBytes: 1, sha256: "c".repeat(64), uploadedById: analystId },
    select: { id: true },
  });
  await assert.rejects(readEvidenceForDownload(prisma, storage, actor(auditorId, "AUDITOR"), escaped.id), /invalidKey/);
});

test("evidence lists only include engagements the user may access", async () => {
  const { engagementId } = await fixture();
  await upload(actor(analystId, "SECURITY_ANALYST"), engagementId, pdf("list me"));
  const visible = await getEvidenceList(prisma, { id: auditorId, role: "AUDITOR" });
  assert.ok(visible.some((record) => record.engagementId === engagementId));
  assert.equal((await getEvidenceList(prisma, { id: outsiderAuditorId, role: "AUDITOR" })).length, 0);
  assert.equal((await getEvidenceList(prisma, { id: viewerId, role: "READ_ONLY_REVIEWER" })).length, 0);
  assert.ok((await getEvidenceList(prisma, { id: adminId, role: "ADMINISTRATOR" })).length >= visible.length);
  const filtered = await getEvidenceList(prisma, { id: auditorId, role: "AUDITOR" }, engagementId);
  assert.ok(filtered.every((record) => record.engagementId === engagementId));
});
