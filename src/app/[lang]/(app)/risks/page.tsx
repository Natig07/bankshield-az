import { loadLocale } from "@/i18n/server";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { getRiskFormOptions, getRiskList, normalizeRiskFilters, summarizeRisks } from "@/lib/risks/data";
import { RiskRegister } from "./risk-register";

export default async function RisksPage({ params, searchParams }: PageProps<"/[lang]/risks">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "risks:read");
  const filters = normalizeRiskFilters(await searchParams);
  const canManage = hasPermission(user.role, "risks:manage");
  let list: Awaited<ReturnType<typeof getRiskList>>;
  let options: Awaited<ReturnType<typeof getRiskFormOptions>>;
  try {
    const prisma = getPrisma();
    [list, options] = await Promise.all([getRiskList(prisma, filters), getRiskFormOptions(prisma)]);
  } catch (error) {
    console.error("Risk register query failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.riskWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.riskWorkflow.dataErrorBody}</p>
      </section>
    );
  }  return (
    <RiskRegister
      lang={lang}
      labels={dict.riskWorkflow}
      filters={filters}
      canManage={canManage}
      summary={summarizeRisks(list)}
      assets={options.assets}
      risks={list.map((risk) => ({
        ...risk,
        reviewDate: risk.reviewDate?.toISOString() ?? null,
        updatedAt: risk.updatedAt.toISOString(),
      }))}
    />
  );
}
