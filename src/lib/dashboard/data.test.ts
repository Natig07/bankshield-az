import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthUser } from "@/lib/auth/service";
import { getDashboardData, getDashboardState } from "./data";

let prisma: PrismaClient;
let testDirectory: string;

const dashboardUser: AuthUser = {
  id: "dashboard-auditor",
  email: "auditor@example.test",
  name: "Dashboard Auditor",
  role: "AUDITOR",
  preferredLocale: "en",
};

before(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "bankshield-dashboard-tests-"));
  const databasePath = join(testDirectory, "dashboard-tests.db");
  const sqlite = new Database(databasePath);
  const migrationRoot = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationRoot, entry.name, "migration.sql"))
    .sort();
  for (const migrationPath of migrations) {
    sqlite.exec(readFileSync(migrationPath, "utf8"));
  }
  sqlite.close();
  prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databasePath }),
  });
});

after(async () => {
  await prisma.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("empty database returns honest empty counts and no static regulatory sources", async () => {
  const data = await getDashboardData(prisma, dashboardUser);
  assert.deepEqual(data.sources, []);
  assert.equal(data.sourceCount, 0);
  assert.equal(data.sourcesPending, 0);
  assert.equal(data.verifiedRequirements, 0);
  assert.equal(data.engagementCount, 0);
  assert.deepEqual(data.assessmentCounts, {});
  assert.deepEqual(data.openFindingCounts, {});
  assert.equal(data.evidenceCount, 0);
  assert.equal(data.overdueActions, 0);
  assert.equal(data.pendingSuggestions, 0);
});

test("dashboard aggregates real records and limits audit metrics to assigned engagements", async () => {
  await prisma.user.create({
    data: {
      id: dashboardUser.id,
      email: dashboardUser.email,
      name: dashboardUser.name,
      passwordHash: "test-only-hash",
      role: dashboardUser.role,
    },
  });
  const engagement = await prisma.auditEngagement.create({
    data: {
      id: "visible-engagement",
      title: "Visible engagement",
      scope: "Test scope",
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-12-31T00:00:00Z"),
      createdById: dashboardUser.id,
    },
  });
  const document = await prisma.regulatoryDocument.create({
    data: {
      code: "TEST-SOURCE",
      title: "Test source",
      issuer: "Test issuer",
      sourceUrl: "https://example.test/source",
      kind: "MANDATORY_LAW",
      language: "en",
      versions: {
        create: {
          versionLabel: "1",
          sourceUrl: "https://example.test/source",
          verificationStatus: "VERIFIED",
          requirements: {
            create: {
              clauseId: "1.1",
              verificationStatus: "VERIFIED",
            },
          },
        },
      },
    },
    include: { versions: { include: { requirements: true } } },
  });
  const control = await prisma.cybersecurityControl.create({
    data: { code: "TEST-CONTROL", title: "Test control" },
  });
  const scopeItem = await prisma.auditScopeItem.create({
    data: {
      engagementId: engagement.id,
      requirementId: document.versions[0].requirements[0].id,
      controlId: control.id,
    },
  });
  await prisma.controlAssessment.create({
    data: { scopeItemId: scopeItem.id, version: 1, status: "NOT_TESTED" },
  });
  const finding = await prisma.auditFinding.create({
    data: {
      engagementId: engagement.id,
      title: "Test finding",
      description: "Test only",
      severity: "HIGH",
      createdById: dashboardUser.id,
    },
  });
  await prisma.evidenceDocument.create({
    data: {
      engagementId: engagement.id,
      originalName: "test.txt",
      storageKey: "test-evidence-key",
      mimeType: "text/plain",
      sizeBytes: 1,
      sha256: "test-hash",
      uploadedById: dashboardUser.id,
    },
  });
  await prisma.remediationAction.create({
    data: {
      findingId: finding.id,
      ownerName: "Test owner",
      actionPlan: "Test action",
      dueDate: new Date("2026-01-01T00:00:00Z"),
      status: "OPEN",
    },
  });

  const data = await getDashboardData(prisma, dashboardUser, new Date("2026-10-15T00:00:00Z"));
  assert.equal(data.sourceCount, 1);
  assert.equal(data.sourcesPending, 0);
  assert.equal(data.sources[0].status, "VERIFIED");
  assert.equal(data.verifiedRequirements, 1);
  assert.equal(data.engagementCount, 1);
  assert.equal(data.assessmentCounts.NOT_TESTED, 1);
  assert.equal(data.untestedAssessments, 1);
  assert.equal(data.openFindingCounts.HIGH, 1);
  assert.equal(data.evidenceCount, 1);
  assert.equal(data.overdueActions, 1);
});

test("database failures return an error state and do not log the error message", async () => {
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const state = await getDashboardState(async () => {
      throw new Error("sensitive database URL");
    });
    assert.deepEqual(state, { status: "error" });
    assert.equal(JSON.stringify(logged).includes("sensitive database URL"), false);
    assert.equal(JSON.stringify(logged).includes("Error"), true);
  } finally {
    console.error = originalError;
  }
});
