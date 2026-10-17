import { z } from "zod";

// Allowed values for the String columns in prisma/schema.prisma.
// Kept as plain strings in the database (portable to PostgreSQL / SQL Server)
// and enforced here, at the application boundary.

export const ROLES = [
  "ADMINISTRATOR",
  "AUDITOR",
  "SECURITY_ANALYST",
  "READ_ONLY_REVIEWER",
] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

// Regulatory verification. Only VERIFIED content may count in compliance metrics.
export const VERIFICATION_STATUSES = [
  "PENDING_VERIFICATION",
  "UNDER_LEGAL_REVIEW",
  "VERIFIED",
  "SUPERSEDED",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);

// Mandatory Azerbaijani legal requirements vs optional frameworks (ISO 27001, NIST CSF).
export const REQUIREMENT_TYPES = ["MANDATORY_LAW", "OPTIONAL_FRAMEWORK"] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];
export const requirementTypeSchema = z.enum(REQUIREMENT_TYPES);

export const ASSESSMENT_STATUSES = [
  "NOT_TESTED",
  "COMPLIANT",
  "PARTIALLY_COMPLIANT",
  "NON_COMPLIANT",
  "NOT_APPLICABLE",
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];
export const assessmentStatusSchema = z.enum(ASSESSMENT_STATUSES);

// AI suggestions always start as PENDING_REVIEW. Only a human reviewer changes this.
export const AI_REVIEW_STATUSES = ["PENDING_REVIEW", "ACCEPTED", "REJECTED"] as const;
export type AiReviewStatus = (typeof AI_REVIEW_STATUSES)[number];

// AI confidence is NOT risk severity and NOT a compliance status.
export const AI_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type AiConfidence = (typeof AI_CONFIDENCE_LEVELS)[number];

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

// Risk register
export const RISK_STATUSES = ["OPEN", "IN_TREATMENT", "ACCEPTED", "CLOSED"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const riskStatusSchema = z.enum(RISK_STATUSES);

export const RISK_CATEGORIES = [
  "GOVERNANCE",
  "ACCESS_CONTROL",
  "DATA_PROTECTION",
  "NETWORK",
  "THIRD_PARTY",
  "BUSINESS_CONTINUITY",
  "APPLICATION",
  "OTHER",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];
export const riskCategorySchema = z.enum(RISK_CATEGORIES);

export const RISK_TREATMENTS = ["MITIGATE", "ACCEPT", "TRANSFER", "AVOID"] as const;
export type RiskTreatment = (typeof RISK_TREATMENTS)[number];
export const riskTreatmentSchema = z.enum(RISK_TREATMENTS);

export const ASSET_TYPES = [
  "APPLICATION",
  "INFRASTRUCTURE",
  "DATA",
  "SERVICE",
  "THIRD_PARTY",
  "FACILITY",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const assetTypeSchema = z.enum(ASSET_TYPES);

export const severitySchema = z.enum(SEVERITIES);

export const TREATMENT_ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type TreatmentActionStatus = (typeof TREATMENT_ACTION_STATUSES)[number];
export const treatmentActionStatusSchema = z.enum(TREATMENT_ACTION_STATUSES);

export const FINDING_STATUSES = ["OPEN", "IN_REMEDIATION", "READY_FOR_REVIEW", "CLOSED"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export const findingStatusSchema = z.enum(FINDING_STATUSES);

export const REMEDIATION_STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED", "VERIFIED"] as const;
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];
export const remediationStatusSchema = z.enum(REMEDIATION_STATUSES);
