import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hasPermission, ROLES } from "./authorization";
import { canSeeNavItem, NAV_ITEMS } from "./nav-access";

const appRoot = path.join(process.cwd(), "src", "app", "[lang]", "(app)");

test("every sidebar entry is gated by the permission its page enforces", () => {
  for (const item of NAV_ITEMS) {
    const file = path.join(appRoot, item.path.replace(/^\//, ""), "page.tsx");
    const source = readFileSync(file, "utf8");
    const match = /requirePagePermission\(lang, "([a-z]+:[a-z]+)"\)/.exec(source);
    assert.ok(match, `${item.key}: page.tsx must call requirePagePermission`);
    assert.equal(match[1], item.permission, `${item.key}: sidebar permission differs from the page`);
  }
});

test("a role sees exactly the sidebar entries whose pages it may open", () => {
  for (const role of ROLES) {
    for (const item of NAV_ITEMS) {
      assert.equal(canSeeNavItem(role, item.key), hasPermission(role, item.permission), `${role}/${item.key}`);
    }
  }
  // Regression: analysts have no reports:read, so "Reports" must not be offered to them.
  assert.equal(canSeeNavItem("SECURITY_ANALYST", "reports"), false);
  assert.equal(canSeeNavItem("SECURITY_ANALYST", "risks"), true);
  assert.equal(canSeeNavItem("AUDITOR", "admin"), false);
  assert.equal(canSeeNavItem("ADMINISTRATOR", "admin"), true);
  assert.equal(canSeeNavItem("NOT_A_ROLE", "dashboard"), false);
});
