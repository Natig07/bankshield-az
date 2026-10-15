// Risk scoring.
//
// Formula (documented, deliberately simple):
//
//     score = likelihood x impact
//
// Both inputs are whole numbers on a configurable scale (default 1..5, so the score
// ranges 1..25). Severity bands are configurable thresholds on the score.
//
// Inherent risk = score before controls. Residual risk = score after controls, with
// its own likelihood/impact inputs. They are separate values and never mixed.
//
// Inputs are human judgments. AI confidence is never an input to risk.

import type { Severity } from "./enums";

export interface RiskScale {
  min: number;
  max: number;
}

export interface RiskBandConfig {
  // Inclusive upper bound of each band; anything above `high` is CRITICAL.
  low: number;
  medium: number;
  high: number;
}

export const DEFAULT_SCALE: RiskScale = { min: 1, max: 5 };
export const DEFAULT_BANDS: RiskBandConfig = { low: 4, medium: 9, high: 16 };

function assertInScale(name: string, value: number, scale: RiskScale): void {
  if (!Number.isInteger(value) || value < scale.min || value > scale.max) {
    throw new RangeError(
      `${name} must be an integer between ${scale.min} and ${scale.max}, got ${value}`,
    );
  }
}

export function riskScore(
  likelihood: number,
  impact: number,
  scale: RiskScale = DEFAULT_SCALE,
): number {
  assertInScale("likelihood", likelihood, scale);
  assertInScale("impact", impact, scale);
  return likelihood * impact;
}

export function riskBand(score: number, bands: RiskBandConfig = DEFAULT_BANDS): Severity {
  if (!Number.isFinite(score) || score < 0) {
    throw new RangeError(`score must be a non-negative number, got ${score}`);
  }
  if (score <= bands.low) return "LOW";
  if (score <= bands.medium) return "MEDIUM";
  if (score <= bands.high) return "HIGH";
  return "CRITICAL";
}
