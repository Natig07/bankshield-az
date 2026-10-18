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
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "regulatory:manage"), false);
});

test("regulatory mutations are administrator-only", () => {
  assert.equal(hasPermission("ADMINISTRATOR", "regulatory:manage"), true);
  assert.equal(hasPermission("AUDITOR", "regulatory:manage"), false);
  assert.equal(hasPermission("SECURITY_ANALYST", "regulatory:manage"), false);
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "regulatory:manage"), false);
  assert.throws(
    () => assertRolePermission("READ_ONLY_REVIEWER", "regulatory:manage"),
    PermissionDeniedError,
  );
});

test("control catalogue and mapping changes are administrator-only", () => {
  assert.equal(hasPermission("ADMINISTRATOR", "controls:manage"), true);
  assert.equal(hasPermission("AUDITOR", "controls:manage"), false);
  assert.equal(hasPermission("SECURITY_ANALYST", "controls:manage"), false);
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "controls:manage"), false);
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

test("evidence upload and review are separate duties", () => {
  // Analysts provide evidence; auditors review it; neither role holds both.
  assert.equal(hasPermission("SECURITY_ANALYST", "evidence:manage"), true);
  assert.equal(hasPermission("SECURITY_ANALYST", "evidence:review"), false);
  assert.equal(hasPermission("AUDITOR", "evidence:review"), true);
  assert.equal(hasPermission("AUDITOR", "evidence:manage"), false);
  assert.equal(hasPermission("ADMINISTRATOR", "evidence:review"), true);
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "evidence:review"), false);
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "evidence:read"), true);
});

test("risk register: every role can read, only administrators and analysts can change it", () => {
  for (const role of ROLES) assert.equal(hasPermission(role, "risks:read"), true);
  assert.equal(hasPermission("ADMINISTRATOR", "risks:manage"), true);
  assert.equal(hasPermission("SECURITY_ANALYST", "risks:manage"), true);
  assert.equal(hasPermission("AUDITOR", "risks:manage"), false);
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "risks:manage"), false);
  // Accepting a risk is a management decision reserved for administrators.
  assert.equal(hasPermission("ADMINISTRATOR", "risks:accept"), true);
  for (const role of ["AUDITOR", "SECURITY_ANALYST", "READ_ONLY_REVIEWER"]) {
    assert.equal(hasPermission(role, "risks:accept"), false);
  }
});

test("remediation work and verification are split between analyst and auditor", () => {
  assert.doesNotThrow(() => assertRolePermission("SECURITY_ANALYST", "findings:remediate"));
  assert.throws(() => assertRolePermission("SECURITY_ANALYST", "findings:manage"), PermissionDeniedError);
  assert.throws(() => assertRolePermission("AUDITOR", "findings:remediate"), PermissionDeniedError);
  assert.throws(() => assertRolePermission("READ_ONLY_REVIEWER", "findings:remediate"), PermissionDeniedError);
  assert.doesNotThrow(() => assertRolePermission("ADMINISTRATOR", "findings:remediate"));
});
