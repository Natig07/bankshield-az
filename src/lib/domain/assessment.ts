import type { AssessmentStatus } from "./enums";

// Assessment rules from the product spec.
// Missing evidence alone is NOT proof of non-compliance: NOT_TESTED is the default and
// the status only moves when a human assesses the control.

export interface AssessmentInput {
  status: AssessmentStatus;
  notApplicableReason?: string | null;
}

export function validateAssessment(input: AssessmentInput): string[] {
  const errors: string[] = [];
  if (input.status === "NOT_APPLICABLE" && !input.notApplicableReason?.trim()) {
    errors.push("NOT_APPLICABLE requires a documented reason.");
  }
  return errors;
}

export interface ApprovalInput {
  status: AssessmentStatus;
  justification?: string | null;
  linkedEvidenceCount: number;
  notApplicableReason?: string | null;
}

// Final approval needs a reviewer justification and, unless the control is not
// applicable, documented evidence. An untested control cannot be approved.
export function validateApproval(input: ApprovalInput): string[] {
  const errors = validateAssessment(input);
  if (input.status === "NOT_TESTED") {
    errors.push("A control that has not been tested cannot be approved.");
  }
  if (!input.justification?.trim()) {
    errors.push("Reviewer justification is required before approval.");
  }
  if (input.status !== "NOT_APPLICABLE" && input.status !== "NOT_TESTED" && input.linkedEvidenceCount < 1) {
    errors.push("Documented evidence is required before approval.");
  }
  return errors;
}

// Evidence in these review states can no longer support an assessment.
export const UNUSABLE_EVIDENCE_STATES: string[] = ["REJECTED", "SUPERSEDED"];
