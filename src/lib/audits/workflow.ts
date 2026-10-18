export const ENGAGEMENT_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "IN_REVIEW",
  "APPROVED",
  "ARCHIVED",
] as const;

export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

const TRANSITIONS: Record<EngagementStatus, readonly EngagementStatus[]> = {
  DRAFT: ["IN_PROGRESS", "ARCHIVED"],
  IN_PROGRESS: ["IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["APPROVED", "IN_PROGRESS", "ARCHIVED"],
  APPROVED: ["ARCHIVED"],
  ARCHIVED: [],
};

// Which engagement statuses allow which kinds of change. Approved and archived
// engagements are locked for scope, metadata, assessment and evidence changes; only
// follow-up remediation continues after approval. IN_REVIEW freezes the maker's work
// (scope, revisions, uploads) so the checker reviews a stable record; the engagement
// must be returned to IN_PROGRESS to change it.
export const ENGAGEMENT_OPERATIONS = [
  "editEngagement",
  "assessControl",
  "approveAssessment",
  "uploadEvidence",
  "reviewEvidence",
  "manageFindings",
  "manageRemediation",
] as const;

export type EngagementOperation = (typeof ENGAGEMENT_OPERATIONS)[number];

const OPERATION_STATUSES: Record<EngagementOperation, readonly EngagementStatus[]> = {
  editEngagement: ["DRAFT", "IN_PROGRESS"],
  assessControl: ["DRAFT", "IN_PROGRESS"],
  approveAssessment: ["DRAFT", "IN_PROGRESS", "IN_REVIEW"],
  uploadEvidence: ["DRAFT", "IN_PROGRESS"],
  reviewEvidence: ["IN_PROGRESS", "IN_REVIEW"],
  manageFindings: ["IN_PROGRESS", "IN_REVIEW"],
  manageRemediation: ["IN_PROGRESS", "IN_REVIEW", "APPROVED"],
};

export function engagementAllows(status: string, operation: EngagementOperation): boolean {
  return (OPERATION_STATUSES[operation] as readonly string[]).includes(status);
}

export function canTransitionEngagementStatus(
  current: string,
  target: string,
): target is EngagementStatus {
  return (
    ENGAGEMENT_STATUSES.includes(current as EngagementStatus) &&
    TRANSITIONS[current as EngagementStatus].includes(target as EngagementStatus)
  );
}
