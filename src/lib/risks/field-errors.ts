import type { ZodError } from "zod";

// Turns schema failures into stable, translatable per-field codes so the form can say
// which field is wrong and why, instead of one generic message.
export type FieldIssueCode = "tooShort" | "tooLong" | "invalid" | "residualPair" | "residualAboveInherent";
export type FieldIssue = { field: string; code: FieldIssueCode; limit?: number };

export function fieldIssues(error: ZodError): FieldIssue[] {
  const seen = new Set<string>();
  const out: FieldIssue[] = [];
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    let next: FieldIssue;
    if (issue.code === "custom" && /Residual risk cannot exceed/i.test(issue.message)) {
      next = { field, code: "residualAboveInherent" };
    } else if (issue.code === "custom" && /provided together/i.test(issue.message)) {
      next = { field, code: "residualPair" };
    } else if (issue.code === "too_small" && issue.origin === "string") {
      next = { field, code: "tooShort", limit: Number(issue.minimum) };
    } else if (issue.code === "too_big" && issue.origin === "string") {
      next = { field, code: "tooLong", limit: Number(issue.maximum) };
    } else {
      next = { field, code: "invalid" };
    }
    const key = `${next.field}:${next.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}
