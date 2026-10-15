import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRolePermission,
  AuthenticationRequiredError,
  hasPermission,
  isRole,
  PermissionDeniedError,
  PERMISSIONS,
  ROLES,
} from "./authorization";

test("role names are restricted to the four supported roles", () => {
  assert.deepEqual(ROLES, [
    "ADMINISTRATOR",
    "AUDITOR",
    "SECURITY_ANALYST",
    "READ_ONLY_REVIEWER",
  ]);
  assert.equal(isRole("AUDITOR"), true);
  assert.equal(isRole("admin"), false);
});

test("administrator can use every application permission", () => {
  for (const permission of PERMISSIONS) {
    assert.equal(hasPermission("ADMINISTRATOR", permission), true);
  }
});

test("auditor can manage audits, assessments, findings and reports", () => {
  for (const permission of [
    "audit:manage",
    "controls:assess",
    "findings:manage",
    "reports:manage",
  ] as const) {
    assert.equal(hasPermission("AUDITOR", permission), true);
  }
  assert.equal(hasPermission("AUDITOR", "users:manage"), false);
  assert.equal(hasPermission("AUDITOR", "evidence:manage"), false);
});

test("security analyst manages evidence and assessments but not administration", () => {
  assert.equal(hasPermission("SECURITY_ANALYST", "evidence:manage"), true);
  assert.equal(hasPermission("SECURITY_ANALYST", "controls:assess"), true);
  assert.equal(hasPermission("SECURITY_ANALYST", "audit:manage"), false);
  assert.equal(hasPermission("SECURITY_ANALYST", "users:manage"), false);
});

test("read-only reviewer has no mutation or administration permissions", () => {
  for (const permission of PERMISSIONS.filter((item) => item.endsWith(":manage") || item.endsWith(":assess"))) {
    assert.equal(hasPermission("READ_ONLY_REVIEWER", permission), false);
  }
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "audit:read"), true);
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "reports:read"), true);
});

test("server authorization denies unauthenticated and unauthorized roles", () => {
  assert.throws(
    () => assertRolePermission(null, "application:access"),
    AuthenticationRequiredError,
  );
  assert.throws(
    () => assertRolePermission("READ_ONLY_REVIEWER", "findings:manage"),
    PermissionDeniedError,
  );
  assert.doesNotThrow(() => assertRolePermission("AUDITOR", "findings:manage"));
});
