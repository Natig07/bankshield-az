import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { hashPassword, verifyPassword } from "./password";
import {
  bootstrapAdministrator,
  hashUserPassword,
  loginWithPassword,
  resolveSession,
  revokeSession,
} from "./service";
import { SESSION_TTL_MS } from "./session-core";
import { canAccessEngagement } from "./resource-access";

let prisma: PrismaClient;
let testDirectory: string;

before(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "bankshield-auth-tests-"));
  const databasePath = join(testDirectory, "auth-tests.db");
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

test("Argon2id hashes passwords and verifies only the correct password", async () => {
  const password = "correct horse battery staple";
  const passwordHash = await hashPassword(password);
  assert.match(passwordHash, /^\$argon2id\$/);
  assert.notEqual(passwordHash, password);
  assert.equal(await verifyPassword(passwordHash, password), true);
  assert.equal(await verifyPassword(passwordHash, "incorrect password"), false);
});

test("bootstrap is disabled in production and validates strong credentials", async () => {
  await assert.rejects(
    bootstrapAdministrator(
      prisma,
      { email: "admin@example.test", name: "Test Admin", password: "A-secure-test-password" },
      true,
    ),
    /disabled in production/,
  );
  await assert.rejects(
    bootstrapAdministrator(
      prisma,
      { email: "admin@example.test", name: "Test Admin", password: "short" },
      false,
    ),
    /12 to 128 characters/,
  );
  assert.equal(await prisma.user.count(), 0);
});

test("concurrent initial-administrator bootstrap succeeds once and cannot be repeated", async () => {
  const input = {
    email: " ADMIN@example.test ",
    name: "Test Administrator",
    password: "test-only-admin-password",
  };
  const results = await Promise.allSettled([
    bootstrapAdministrator(prisma, input, false),
    bootstrapAdministrator(prisma, { ...input, email: "other@example.test" }, false),
  ]);
  const successful = results.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof bootstrapAdministrator>>> =>
      result.status === "fulfilled",
  );
  assert.equal(successful.length, 1);
  assert.equal(await prisma.user.count({ where: { role: "ADMINISTRATOR" } }), 1);
  assert.equal(await prisma.bootstrapState.count(), 1);
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: successful[0].value.id } });
  assert.notEqual(admin.passwordHash, input.password);
  assert.equal(await verifyPassword(admin.passwordHash, input.password), true);
  await assert.rejects(
    bootstrapAdministrator(prisma, input, false),
    /already been completed/,
  );
});

test("valid login creates a hashed, expiring database session; invalid login is generic", async () => {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMINISTRATOR" } });
  const result = await loginWithPassword(prisma, admin.email.toUpperCase(), "test-only-admin-password");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.expiresAt.getTime() - Date.now() < SESSION_TTL_MS + 1000, true);
  const stored = await prisma.session.findUniqueOrThrow({
    where: { tokenHash: (await import("./session-core")).hashSessionToken(result.token) },
  });
  assert.notEqual(stored.tokenHash, result.token);
  assert.equal((await resolveSession(prisma, result.token))?.email, admin.email);
  assert.deepEqual(
    await loginWithPassword(prisma, admin.email, "wrong-password"),
    { ok: false },
  );
  assert.deepEqual(
    await loginWithPassword(prisma, "missing@example.test", "wrong-password"),
    { ok: false },
  );
});

test("five failed logins lock the account for fifteen minutes", async () => {
  const user = await prisma.user.create({
    data: {
      email: "locked@example.test",
      name: "Locked User",
      passwordHash: await hashUserPassword("test-only-user-password"),
      role: "AUDITOR",
    },
  });
  const now = new Date();
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(
      await loginWithPassword(prisma, user.email, "wrong-password", now),
      { ok: false },
    );
  }
  const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(locked.failedLoginCount, 0);
  assert.equal(locked.lockedUntil?.getTime(), now.getTime() + 15 * 60 * 1000);
  assert.deepEqual(
    await loginWithPassword(prisma, user.email, "test-only-user-password", now),
    { ok: false },
  );
});

test("expired, disabled, and revoked sessions cannot authenticate", async () => {
  const user = await prisma.user.create({
    data: {
      email: "session@example.test",
      name: "Session User",
      passwordHash: await hashUserPassword("test-only-session-password"),
      role: "READ_ONLY_REVIEWER",
    },
  });
  const login = await loginWithPassword(prisma, user.email, "test-only-session-password");
  assert.equal(login.ok, true);
  if (!login.ok) return;

  assert.equal(await resolveSession(prisma, login.token, login.expiresAt), null);
  assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);

  const secondLogin = await loginWithPassword(prisma, user.email, "test-only-session-password");
  assert.equal(secondLogin.ok, true);
  if (!secondLogin.ok) return;
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  assert.deepEqual(
    await loginWithPassword(prisma, user.email, "test-only-session-password"),
    { ok: false },
  );
  assert.equal(await resolveSession(prisma, secondLogin.token), null);

  await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  const thirdLogin = await loginWithPassword(prisma, user.email, "test-only-session-password");
  assert.equal(thirdLogin.ok, true);
  if (!thirdLogin.ok) return;
  await revokeSession(prisma, thirdLogin.token);
  assert.equal(await resolveSession(prisma, thirdLogin.token), null);
});

test("engagement records are restricted to creators and assigned members", async () => {
  const creator = await prisma.user.create({
    data: {
      email: "creator@example.test",
      name: "Engagement Creator",
      passwordHash: await hashUserPassword("creator-only-test-password"),
      role: "AUDITOR",
    },
  });
  const member = await prisma.user.create({
    data: {
      email: "member@example.test",
      name: "Assigned Analyst",
      passwordHash: await hashUserPassword("member-only-test-password"),
      role: "SECURITY_ANALYST",
    },
  });
  const outsider = await prisma.user.create({
    data: {
      email: "outsider@example.test",
      name: "Unassigned Analyst",
      passwordHash: await hashUserPassword("outsider-only-test-password"),
      role: "SECURITY_ANALYST",
    },
  });
  const engagement = await prisma.auditEngagement.create({
    data: {
      title: "Isolated authorization test",
      scope: "Test-only engagement",
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-12-31T00:00:00.000Z"),
      createdById: creator.id,
    },
  });
  const memberUser = { ...member, role: "SECURITY_ANALYST" as const };
  const outsiderUser = { ...outsider, role: "SECURITY_ANALYST" as const };
  assert.equal(await canAccessEngagement(prisma, memberUser, engagement.id), false);
  assert.equal(await canAccessEngagement(prisma, outsiderUser, engagement.id), false);
  await prisma.auditEngagementMember.create({
    data: { engagementId: engagement.id, userId: member.id },
  });
  assert.equal(await canAccessEngagement(prisma, memberUser, engagement.id), true);
  assert.equal(
    await canAccessEngagement(prisma, { ...creator, role: "AUDITOR" }, engagement.id),
    true,
  );
  assert.equal(
    await canAccessEngagement(prisma, { ...outsider, role: "ADMINISTRATOR" }, engagement.id),
    true,
  );
});
