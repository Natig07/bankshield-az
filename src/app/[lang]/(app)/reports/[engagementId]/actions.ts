"use server";

import { revalidatePath } from "next/cache";
import { hasLocale } from "@/i18n/config";
import { requirePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { recordReportGeneration, ReportNotFoundError } from "@/lib/reports/service";

export type ReportActionState = { error?: "failed"; success?: "recorded" } | null;

export async function recordReportAction(_previous: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const actor = await requirePermission("reports:manage");
  const lang = formData.get("lang");
  const engagementId = formData.get("engagementId");
  if (typeof lang !== "string" || !hasLocale(lang) || typeof engagementId !== "string") return { error: "failed" };
  try {
    await recordReportGeneration(getPrisma(), actor, engagementId, lang);
  } catch (error) {
    if (error instanceof ReportNotFoundError) return { error: "failed" };
    throw error;
  }
  revalidatePath(`/${lang}/reports/${engagementId}`);
  return { success: "recorded" };
}
