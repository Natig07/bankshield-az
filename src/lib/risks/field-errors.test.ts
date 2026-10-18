import assert from "node:assert/strict";
import test from "node:test";
import { createRiskSchema } from "./service";
import { fieldIssues } from "./field-errors";

const valid = {
  title: "Privileged access gaps",
  description: "Dormant privileged accounts are not reviewed.",
  category: "OTHER",
  assetId: null,
  ownerName: "Fictional Owner",
  inherentLikelihood: 3,
  inherentImpact: 3,
  residualLikelihood: null,
  residualImpact: null,
  treatment: null,
  reviewDate: null,
};

function issues(patch: Record<string, unknown>) {
  const result = createRiskSchema.safeParse({ ...valid, ...patch });
  assert.equal(result.success, false);
  return result.success ? [] : fieldIssues(result.error);
}

test("residual risk above inherent risk names the residual field", () => {
  const found = issues({ inherentLikelihood: 2, inherentImpact: 2, residualLikelihood: 4, residualImpact: 4 });
  assert.deepEqual(found, [{ field: "residualImpact", code: "residualAboveInherent" }]);
});

test("a single residual value asks for both", () => {
  assert.deepEqual(issues({ residualLikelihood: 2 }), [{ field: "residualImpact", code: "residualPair" }]);
});

test("short and long text report the field and the limit", () => {
  assert.deepEqual(issues({ title: "ab" }), [{ field: "title", code: "tooShort", limit: 3 }]);
  assert.deepEqual(issues({ ownerName: "x".repeat(121) }), [{ field: "ownerName", code: "tooLong", limit: 120 }]);
});

test("several problems are all reported once", () => {
  const found = issues({ title: "ab", description: "short" });
  assert.deepEqual(found.map((item) => item.field).sort(), ["description", "title"]);
});
