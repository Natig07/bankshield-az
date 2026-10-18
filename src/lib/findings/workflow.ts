import type { FindingStatus, RemediationStatus } from "@/lib/domain/enums";
import { FINDING_STATUSES, REMEDIATION_STATUSES } from "@/lib/domain/enums";

// Finding lifecycle. Every forward step has a precondition checked by the service:
//   OPEN -> IN_REMEDIATION          at least one remediation action exists
//   IN_REMEDIATION -> READY_FOR_REVIEW  every action is completed or verified
//   READY_FOR_REVIEW -> CLOSED      every action is verified, closer is not the finding's creator
//   READY_FOR_REVIEW -> IN_REMEDIATION  reviewer sends it back (note required)
// CLOSED is terminal.
const FINDING_TRANSITIONS: Record<FindingStatus, readonly FindingStatus[]> = {
  OPEN: ["IN_REMEDIATION"],
  IN_REMEDIATION: ["READY_FOR_REVIEW"],
  READY_FOR_REVIEW: ["CLOSED", "IN_REMEDIATION"],
  CLOSED: [],
};

export function canTransitionFinding(current: string, target: string): target is FindingStatus {
  return (
    (FINDING_STATUSES as readonly string[]).includes(current) &&
    FINDING_TRANSITIONS[current as FindingStatus].includes(target as FindingStatus)
  );
}

// Finding fields may be edited until the finding is handed over for review.
export function isFindingEditable(status: string): boolean {
  return status === "OPEN" || status === "IN_REMEDIATION";
}

// Actions may be added while the finding is still being worked on.
export function canAddRemediationAction(status: string): boolean {
  return status === "OPEN" || status === "IN_REMEDIATION";
}

// Remediation action lifecycle. Moving to VERIFIED is the independent check and needs
// findings:manage; the earlier steps need findings:remediate.
const ACTION_TRANSITIONS: Record<RemediationStatus, readonly RemediationStatus[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["VERIFIED", "IN_PROGRESS"],
  VERIFIED: [],
};

export function canTransitionRemediation(current: string, target: string): target is RemediationStatus {
  return (
    (REMEDIATION_STATUSES as readonly string[]).includes(current) &&
    ACTION_TRANSITIONS[current as RemediationStatus].includes(target as RemediationStatus)
  );
}

export function isRemediationOverdue(action: { status: string; dueDate: Date }, now: Date): boolean {
  return (action.status === "OPEN" || action.status === "IN_PROGRESS") && action.dueDate.getTime() < now.getTime();
}
