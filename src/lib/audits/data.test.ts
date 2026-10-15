import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/lib/auth/authorization";
import { createEngagement, transitionEngagement } from "./service";
import {
  getEngagementDetails,
  getEngagementList,
  normalizeEngagementFilters,
} from "./data";

let prisma: PrismaClient;
let testDirectory: string;
let auditorOne: { id: string; role: Role };
let auditorTwo: { id: string; role: Role };
let viewer: { id: string; role: Role };
let administrator: { id: string; role: Role };

before(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "bankshield-audit-data-tests-"));
  const databasePath = join(testDirectory, "audit-data-tests.db");
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
    prisma.user.create({ data: { email: "data-auditor-one@example.test", name: "Data Auditor One", passwordHash: "test-hash", role: "AUDITOR" } }),
    prisma.user.create({ data: { email: "data-auditor-two@example.test", name: "Data Auditor Two", passwordHash: "test-hash", role: "AUDITOR" } }),
    prisma.user.create({ data: { email: "data-viewer@example.test", name: "Data Viewer", passwordHash: "test-hash", role: "READ_ONLY_REVIEWER" } }),
    prisma.user.create({ data: { email: "data-admin@example.test", name: "Data Administrator", passwordHash: "test-hash", role: "ADMINISTRATOR" } }),
  ]);
  auditorOne = { id: users[0].id, role: "AUDITOR" };
  auditorTwo = { id: users[1].id, role: "AUDITOR" };
  viewer = { id: users[2].id, role: "READ_ONLY_REVIEWER" };
  administrator = { id: users[3].id, role: "ADMINISTRATOR" };
});

after(async () => {
  await prisma.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

function input(title: string, assignedAuditorId: string) {
  return {
    title,
    auditedOrganization: `${title} Bank`,
    scope: "Access governance.",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    assignedAuditorId,
  };
}

test("engagement list has honest empty state, filters results, and enforces engagement visibility", async () => {
  assert.deepEqual(await getEngagementList(prisma, auditorOne, normalizeEngagementFilters({})), []);
  const first = await createEngagement(prisma, auditorOne, input("First audit", auditorOne.id));
  const second = await createEngagement(prisma, auditorTwo, input("Second review", auditorTwo.id));
  await transitionEngagement(prisma, auditorTwo.id, second.id, "IN_PROGRESS");

  assert.equal((await getEngagementList(prisma, administrator, normalizeEngagementFilters({}))).length, 2);
  assert.equal((await getEngagementList(prisma, auditorOne, normalizeEngagementFilters({}))).length, 1);
  assert.equal((await getEngagementList(prisma, auditorTwo, normalizeEngagementFilters({}))).length, 1);
  assert.equal((await getEngagementList(prisma, viewer, normalizeEngagementFilters({}))).length, 0);
  assert.equal((await getEngagementList(
    prisma,
    administrator,
    normalizeEngagementFilters({ search: "Second", status: "IN_PROGRESS" }),
  )).length, 1);
  assert.equal((await getEngagementList(
    prisma,
    administrator,
    normalizeEngagementFilters({ search: "missing", status: "DRAFT" }),
  )).length, 0);
  assert.equal(normalizeEngagementFilters({ status: "NOT_A_STATUS" }).status, "ALL");
  assert.equal(await getEngagementDetails(prisma, auditorTwo, first.id), null);
  assert.equal((await getEngagementDetails(prisma, viewer, first.id))?.id, undefined);
});

test("database errors propagate instead of producing an empty list", async () => {
  const emptyPath = join(testDirectory, "not-migrated.db");
  const emptySqlite = new Database(emptyPath);
  emptySqlite.close();
  const emptyDb = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: emptyPath }) });
  try {
    await assert.rejects(
      getEngagementList(emptyDb, auditorOne, normalizeEngagementFilters({})),
    );
  } finally {
    await emptyDb.$disconnect();
  }
});
