export function canTransitionVerificationStatus(from: string, to: string): boolean {
  const allowed: Record<string, readonly string[]> = {
    PENDING_VERIFICATION: ["UNDER_LEGAL_REVIEW"],
    UNDER_LEGAL_REVIEW: ["PENDING_VERIFICATION", "VERIFIED"],
    VERIFIED: ["SUPERSEDED"],
    SUPERSEDED: [],
  };
  return allowed[from]?.includes(to) ?? false;
}
