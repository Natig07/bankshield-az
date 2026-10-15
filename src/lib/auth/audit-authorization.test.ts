import assert from "node:assert/strict";
import test from "node:test";
import { assertRolePermission, hasPermission, PermissionDeniedError } from "./authorization";

test("audit engagement mutations require audit:manage while read-only users retain read access", () => {
  for (const role of ["ADMINISTRATOR", "AUDITOR"]) {
    assert.equal(hasPermission(role, "audit:read"), true);
    assert.equal(hasPermission(role, "audit:manage"), true);
    assert.doesNotThrow(() => assertRolePermission(role, "audit:manage"));
  }
  for (const role of ["SECURITY_ANALYST", "READ_ONLY_REVIEWER"]) {
    assert.equal(hasPermission(role, "audit:read"), true);
    assert.equal(hasPermission(role, "audit:manage"), false);
    assert.throws(() => assertRolePermission(role, "audit:manage"), PermissionDeniedError);
  }
});

test("only administrators may add assigned auditors to an existing engagement", () => {
  assert.equal(hasPermission("ADMINISTRATOR", "users:manage"), true);
  assert.equal(hasPermission("AUDITOR", "users:manage"), false);
  assert.equal(hasPermission("READ_ONLY_REVIEWER", "users:manage"), false);
});
