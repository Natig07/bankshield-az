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

export function canTransitionEngagementStatus(
  current: string,
  target: string,
): target is EngagementStatus {
  return (
    ENGAGEMENT_STATUSES.includes(current as EngagementStatus) &&
    TRANSITIONS[current as EngagementStatus].includes(target as EngagementStatus)
  );
}
