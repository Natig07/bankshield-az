import { loadLocale } from "@/i18n/server";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { getFindingEngagements, getFindingList, normalizeFindingFilters, summarizeFindings } from "@/lib/findings/data";
import { FindingRegister } from "./finding-register";

export default async function FindingsPage({ params, searchParams }: PageProps<"/[lang]/findings">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "findings:read");
  const filters = normalizeFindingFilters(await searchParams);
  const canManage = hasPermission(user.role, "findings:manage");
  let list: Awaited<ReturnType<typeof getFindingList>>;
  let engagements: Awaited<ReturnType<typeof getFindingEngagements>> = [];
  try {
    const prisma = getPrisma();
    [list, engagements] = await Promise.all([
      getFindingList(prisma, user, filters),
      canManage ? getFindingEngagements(prisma, user) : Promise.resolve([]),
    ]);
  } catch (error) {
    console.error("Finding register query failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.findingWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.findingWorkflow.dataErrorBody}</p>
      </section>
    );
  }
  return (
    <FindingRegister
      lang={lang}
      labels={dict.findingWorkflow}
      filters={filters}
      canManage={canManage}
      summary={summarizeFindings(list)}
      engagements={engagements}
      findings={list.map((f) => ({ ...f, updatedAt: f.updatedAt.toISOString() }))}
    />
  );
}
