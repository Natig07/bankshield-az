import { loadLocale } from "@/i18n/server";
import { readGeminiConfig } from "@/lib/ai-review/config";
import { getAiReviewData, normalizeFilter } from "@/lib/ai-review/data";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { AiReviewWorkspace } from "./ai-review-workspace";

export default async function Page({ params, searchParams }: PageProps<"/[lang]/ai-review">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "audit:read");
  const query = await searchParams;
  const engagementParam = Array.isArray(query.engagement) ? query.engagement[0] : query.engagement;
  const filter = normalizeFilter(query.status);
  // Suggestions are derived from controls, findings, risks and requirements, so showing them
  // requires read access to each of those sources.
  const canViewAnalysis = (["regulatory:read", "controls:read", "findings:read", "risks:read"] as const).every((permission) =>
    hasPermission(user.role, permission),
  );
  const canManage = canViewAnalysis && hasPermission(user.role, "audit:manage");

  let data: Awaited<ReturnType<typeof getAiReviewData>>;
  try {
    data = await getAiReviewData(getPrisma(), user, canViewAnalysis ? (engagementParam ?? null) : null, filter);
  } catch (error) {
    console.error("AI review query failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.aiReviewWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.aiReviewWorkflow.dataErrorBody}</p>
      </section>
    );
  }

  return (
    <AiReviewWorkspace
      lang={lang}
      title={dict.sections.aiReview.title}
      description={dict.sections.aiReview.description}
      labels={dict.aiReviewWorkflow}
      data={data}
      filter={filter}
      canViewAnalysis={canViewAnalysis}
      canManage={canManage}
      geminiConfigured={readGeminiConfig().ok}
    />
  );
}
