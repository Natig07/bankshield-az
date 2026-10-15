import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import {
  addRegulatoryVersion,
  createRegulatoryRequirement,
  createRegulatorySource,
  createSourceSchema,
  DuplicateRegulatoryRecordError,
  InvalidVerificationTransitionError,
  RegulatoryRecordLockedError,
  transitionRegulatoryRequirement,
  transitionRegulatoryVersion,
  updateRegulatoryRequirement,
  updateRegulatoryVersion,
} from "./service";

let prisma: PrismaClient;
let testDirectory: string;

before(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "bankshield-regulatory-tests-"));
  const databasePath = join(testDirectory, "regulatory-tests.db");
  const sqlite = new Database(databasePath);
  const migrationRoot = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationRoot, entry.name, "migration.sql"))
    .sort();
  for (const migrationPath of migrations) sqlite.exec(readFileSync(migrationPath, "utf8"));
  sqlite.close();
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) });
});

after(async () => {
  await prisma.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

const sourceInput = {
  code: "test-law-1",
  title: "Official test regulation",
  issuer: "Test authority",
  sourceUrl: "https://authority.example.test/legal/one",
  kind: "MANDATORY_LAW",
  language: "az",
  versionLabel: "2025",
  decisionNumber: "",
  decisionDate: "",
  effectiveFrom: "",
  effectiveTo: "",
};

test("source and requirement lifecycle validates, deduplicates, tracks verification, and locks reviewed content", async () => {
  const invalidDate = createSourceSchema.safeParse({
    ...sourceInput,
    decisionDate: "2026-02-31",
  });
  assert.equal(invalidDate.success, false);
  const reversedRange = createSourceSchema.safeParse({
    ...sourceInput,
    effectiveFrom: "2026-12-01",
    effectiveTo: "2026-01-01",
  });
  assert.equal(reversedRange.success, false);
  assert.equal(
    createSourceSchema.safeParse({ ...sourceInput, sourceUrl: "javascript:alert(1)" }).success,
    false,
  );
  assert.equal(
    createSourceSchema.safeParse({ ...sourceInput, sourceUrl: "not-a-url" }).success,
    false,
  );

  const source = await createRegulatorySource(prisma, sourceInput);
  const version = await prisma.regulatoryVersion.findFirstOrThrow({
    where: { documentId: source.id },
  });
  assert.equal(version.verificationStatus, "PENDING_VERIFICATION");
  assert.equal(version.decisionDate, null);
  assert.equal(version.effectiveFrom, null);

  await assert.rejects(
    createRegulatorySource(prisma, sourceInput),
    DuplicateRegulatoryRecordError,
  );

  const requirementInput = {
    versionId: version.id,
    clauseId: "7.4.3",
    section: "",
    topic: "Access control",
    textOriginal: "",
    textTranslation: "",
    translationLabel: "",
    translationSource: "",
    applicability: "",
    requirementType: "MANDATORY_LAW",
  };
  const requirement = await createRegulatoryRequirement(prisma, requirementInput);
  const pendingRequirement = await prisma.regulatoryRequirement.findUniqueOrThrow({
    where: { id: requirement.id },
  });
  assert.equal(pendingRequirement.verificationStatus, "PENDING_VERIFICATION");
  assert.equal(pendingRequirement.isDemo, false);
  assert.equal(pendingRequirement.applicability, null);
  await assert.rejects(
    createRegulatoryRequirement(prisma, requirementInput),
    DuplicateRegulatoryRecordError,
  );

  await updateRegulatoryRequirement(prisma, {
    requirementId: requirement.id,
    ...requirementInput,
    textOriginal: "Text copied from a verified primary source.",
  });
  await transitionRegulatoryRequirement(
    prisma,
    requirement.id,
    "reviewer-user-id",
    { targetStatus: "UNDER_LEGAL_REVIEW", note: "Legal review started." },
  );
  await assert.rejects(
    transitionRegulatoryRequirement(
      prisma,
      requirement.id,
      "reviewer-user-id",
      { targetStatus: "VERIFIED", note: "Cannot verify before its source version." },
    ),
    InvalidVerificationTransitionError,
  );
  await assert.rejects(
    updateRegulatoryRequirement(prisma, {
      requirementId: requirement.id,
      ...requirementInput,
      topic: "Changed during legal review",
    }),
    RegulatoryRecordLockedError,
  );

  await transitionRegulatoryVersion(
    prisma,
    version.id,
    "reviewer-user-id",
    { targetStatus: "UNDER_LEGAL_REVIEW", note: "Compared with official publication." },
  );
  await transitionRegulatoryVersion(
    prisma,
    version.id,
    "reviewer-user-id",
    { targetStatus: "VERIFIED", note: "Decision details checked against the official record." },
  );
  await transitionRegulatoryRequirement(
    prisma,
    requirement.id,
    "reviewer-user-id",
    { targetStatus: "VERIFIED", note: "Clause text confirmed against the source." },
  );

  const history = await prisma.verificationEvent.findMany({
    where: { OR: [{ versionId: version.id }, { requirementId: requirement.id }] },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(history.length, 4);
  assert.ok(history.every((event) => event.actorId === "reviewer-user-id" && event.note));
  const verifiedVersion = await prisma.regulatoryVersion.findUniqueOrThrow({
    where: { id: version.id },
  });
  assert.equal(verifiedVersion.verificationStatus, "VERIFIED");
  assert.equal(verifiedVersion.verifiedById, "reviewer-user-id");
  assert.ok(verifiedVersion.verifiedAt);

  await assert.rejects(
    updateRegulatoryVersion(prisma, {
      versionId: version.id,
      sourceUrl: sourceInput.sourceUrl,
      decisionNumber: "",
      decisionDate: "",
      effectiveFrom: "",
      effectiveTo: "",
    }),
    RegulatoryRecordLockedError,
  );
  await assert.rejects(
    transitionRegulatoryVersion(
      prisma,
      version.id,
      "reviewer-user-id",
      { targetStatus: "PENDING_VERIFICATION", note: "Invalid backward transition." },
    ),
    InvalidVerificationTransitionError,
  );
  await transitionRegulatoryVersion(
    prisma,
    version.id,
    "reviewer-user-id",
    { targetStatus: "SUPERSEDED", note: "A later version replaces this record." },
  );

  const nextVersion = await addRegulatoryVersion(prisma, {
    documentId: source.id,
    versionLabel: "2026",
    sourceUrl: sourceInput.sourceUrl,
    decisionNumber: "",
    decisionDate: "",
    effectiveFrom: "",
    effectiveTo: "",
  });
  assert.ok(nextVersion.id);
  await assert.rejects(
    addRegulatoryVersion(prisma, {
      documentId: source.id,
      versionLabel: "2026",
      sourceUrl: sourceInput.sourceUrl,
      decisionNumber: "",
      decisionDate: "",
      effectiveFrom: "",
      effectiveTo: "",
    }),
    DuplicateRegulatoryRecordError,
  );
});
