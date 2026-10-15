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
