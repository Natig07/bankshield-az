import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { RISK_CATEGORIES, RISK_STATUSES, SEVERITIES, type Severity } from "@/lib/domain/enums";
import { riskBand, riskScore } from "@/lib/domain/risk";
import { isTreatmentActionActive } from "./workflow";

export type RiskFilters = { search: string; status: string; category: string; band: string };
type RawParam = string | string[] | undefined;

function first(value: RawParam): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function normalizeRiskFilters(input: { q?: RawParam; status?: RawParam; category?: RawParam; band?: RawParam }): RiskFilters {
  const pick = (value: RawParam, allowed: readonly string[]) => (allowed.includes(first(value)) ? first(value) : "ALL");
  return {
    search: first(input.q).trim().slice(0, 120),
    status: pick(input.status, RISK_STATUSES),
    category: pick(input.category, RISK_CATEGORIES),
    band: pick(input.band, SEVERITIES),
  };
}

type Scored = {
  inherentLikelihood: number;
  inherentImpact: number;
  residualLikelihood: number | null;
  residualImpact: number | null;
};

// Scores are derived, never stored. The "current" score is the residual one once it has
// been assessed, otherwise the inherent one; the UI always says which one it shows.
export function scoreRisk(risk: Scored) {
  const inherentScore = riskScore(risk.inherentLikelihood, risk.inherentImpact);
  const residualScore =
    risk.residualLikelihood !== null && risk.residualImpact !== null
      ? riskScore(risk.residualLikelihood, risk.residualImpact)
      : null;
  const currentScore = residualScore ?? inherentScore;
  return {
    inherentScore,
    inherentBand: riskBand(inherentScore),
    residualScore,
    residualBand: residualScore === null ? null : riskBand(residualScore),
    currentScore,
    currentBand: riskBand(currentScore),
    currentBasis: residualScore === null ? ("INHERENT" as const) : ("RESIDUAL" as const),
  };
}

const riskSelect = {
  id: true,
  code: true,
  title: true,
  category: true,
  status: true,
  ownerName: true,
  treatment: true,
  reviewDate: true,
  revision: true,
  inherentLikelihood: true,
  inherentImpact: true,
  residualLikelihood: true,
  residualImpact: true,
  updatedAt: true,
  asset: { select: { id: true, code: true, name: true } },
  actions: { select: { status: true, dueDate: true } },
} as const;

export async function getRiskList(db: PrismaClient, filters: RiskFilters, now = new Date()) {
  const rows = await db.risk.findMany({
    where: {
      ...(filters.status === "ALL" ? {} : { status: filters.status }),
      ...(filters.category === "ALL" ? {} : { category: filters.category }),
      ...(filters.search
        ? {
            OR: [
              { code: { contains: filters.search } },
              { title: { contains: filters.search } },
              { ownerName: { contains: filters.search } },
              { asset: { name: { contains: filters.search } } },
            ],
          }
        : {}),
    },
    select: riskSelect,
  });
  const list = rows
    .map(({ actions, ...risk }) => ({
      ...risk,
      ...scoreRisk(risk),
      openActions: actions.filter(({ status }) => isTreatmentActionActive(status)).length,
      overdueActions: actions.filter(({ status, dueDate }) => isTreatmentActionActive(status) && dueDate < now).length,
    }))
    .filter((risk) => filters.band === "ALL" || risk.currentBand === filters.band)
    .sort((a, b) => b.currentScore - a.currentScore || a.code.localeCompare(b.code));
  return list;
}

// Counts of risks that are still being managed (not closed), by current severity band.
export function summarizeRisks(list: { status: string; currentBand: Severity; overdueActions: number }[]) {
  const bands: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  let active = 0;
  let overdue = 0;
  for (const risk of list) {
    if (risk.status === "CLOSED") continue;
    active += 1;
    bands[risk.currentBand] += 1;
    overdue += risk.overdueActions;
  }
  return { active, bands, overdueActions: overdue };
}

export async function getRiskDetails(db: PrismaClient, riskId: string) {
  const risk = await db.risk.findUnique({
    where: { id: riskId },
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      category: true,
      status: true,
      ownerName: true,
      treatment: true,
      reviewDate: true,
      revision: true,
      acceptanceJustification: true,
      acceptedAt: true,
      acceptedById: true,
      createdAt: true,
      updatedAt: true,
      inherentLikelihood: true,
      inherentImpact: true,
      residualLikelihood: true,
      residualImpact: true,
      assetId: true,
      asset: { select: { id: true, code: true, name: true, criticality: true } },
      controls: {
        orderBy: { linkedAt: "asc" },
        select: { id: true, control: { select: { id: true, code: true, title: true } } },
      },
      actions: {
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        select: { id: true, title: true, description: true, ownerName: true, dueDate: true, status: true, completedAt: true },
      },
      history: {
        orderBy: { revision: "desc" },
        take: 30,
        select: { id: true, revision: true, changeNote: true, createdAt: true, changedById: true },
      },
    },
  });
  if (!risk) return null;
  return { ...risk, ...scoreRisk(risk) };
}

export async function getRiskFormOptions(db: PrismaClient) {
  const [assets, controls] = await Promise.all([
    db.asset.findMany({
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true, assetType: true, criticality: true, ownerName: true, description: true, isActive: true },
    }),
    db.cybersecurityControl.findMany({
      where: { isDemo: false },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, title: true },
    }),
  ]);
  return { assets, controls };
}
