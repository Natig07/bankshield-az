import type { RiskStatus, TreatmentActionStatus } from "@/lib/domain/enums";
import { RISK_STATUSES, TREATMENT_ACTION_STATUSES } from "@/lib/domain/enums";

// Risk lifecycle. ACCEPTED is a management decision and needs the risks:accept
// permission; CLOSED needs every treatment action finished; CLOSED and ACCEPTED risks
// are reopened explicitly (with a note) before they can be edited again.
const RISK_TRANSITIONS: Record<RiskStatus, readonly RiskStatus[]> = {
  OPEN: ["IN_TREATMENT", "ACCEPTED", "CLOSED"],
  IN_TREATMENT: ["OPEN", "ACCEPTED", "CLOSED"],
  ACCEPTED: ["OPEN", "CLOSED"],
  CLOSED: ["OPEN"],
};

export function canTransitionRisk(current: string, target: string): target is RiskStatus {
  return (
    (RISK_STATUSES as readonly string[]).includes(current) &&
    RISK_TRANSITIONS[current as RiskStatus].includes(target as RiskStatus)
  );
}

// Fields of a risk may be edited only while it is being worked on.
export function isRiskEditable(status: string): boolean {
  return status === "OPEN" || status === "IN_TREATMENT";
}

const ACTION_TRANSITIONS: Record<TreatmentActionStatus, readonly TreatmentActionStatus[]> = {
  OPEN: ["IN_PROGRESS", "DONE", "CANCELLED"],
  IN_PROGRESS: ["DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

export function canTransitionTreatmentAction(current: string, target: string): target is TreatmentActionStatus {
  return (
    (TREATMENT_ACTION_STATUSES as readonly string[]).includes(current) &&
    ACTION_TRANSITIONS[current as TreatmentActionStatus].includes(target as TreatmentActionStatus)
  );
}

export function isTreatmentActionActive(status: string): boolean {
  return status === "OPEN" || status === "IN_PROGRESS";
}
