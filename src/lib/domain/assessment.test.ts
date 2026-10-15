import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateApproval, validateAssessment } from "./assessment";

describe("validateAssessment", () => {
  it("requires a reason for NOT_APPLICABLE", () => {
    assert.equal(validateAssessment({ status: "NOT_APPLICABLE" }).length, 1);
    assert.equal(validateAssessment({ status: "NOT_APPLICABLE", notApplicableReason: "   " }).length, 1);
    assert.deepEqual(
      validateAssessment({ status: "NOT_APPLICABLE", notApplicableReason: "Service not offered" }),
      [],
    );
  });

  it("does not require a reason for other statuses", () => {
    for (const status of ["NOT_TESTED", "COMPLIANT", "PARTIALLY_COMPLIANT", "NON_COMPLIANT"] as const) {
      assert.deepEqual(validateAssessment({ status }), []);
    }
  });
});

describe("validateApproval", () => {
  it("blocks approval of an untested control", () => {
    const errors = validateApproval({ status: "NOT_TESTED", justification: "x", linkedEvidenceCount: 3 });
    assert.ok(errors.some((e) => e.includes("not been tested")));
  });

  it("requires reviewer justification", () => {
    const errors = validateApproval({ status: "COMPLIANT", justification: " ", linkedEvidenceCount: 1 });
    assert.ok(errors.some((e) => e.includes("justification")));
  });

  it("requires evidence unless the control is not applicable", () => {
    const noEvidence = validateApproval({ status: "NON_COMPLIANT", justification: "ok", linkedEvidenceCount: 0 });
    assert.ok(noEvidence.some((e) => e.includes("evidence")));

    const notApplicable = validateApproval({
      status: "NOT_APPLICABLE",
      notApplicableReason: "Out of scope",
      justification: "ok",
      linkedEvidenceCount: 0,
    });
    assert.deepEqual(notApplicable, []);
  });

  it("accepts a fully documented assessment", () => {
    assert.deepEqual(
      validateApproval({ status: "PARTIALLY_COMPLIANT", justification: "Reviewed", linkedEvidenceCount: 2 }),
      [],
    );
  });
});
