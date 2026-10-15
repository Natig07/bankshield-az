import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { loadLocale } from "@/i18n/server";
import {
  getEngagementList,
  logEngagementQueryFailure,
  normalizeEngagementFilters,
} from "@/lib/audits/data";
import { EngagementList } from "./engagement-list";

export default async function AuditsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/audits">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "audit:read");
  const filters = normalizeEngagementFilters(await searchParams);
  const canManage = hasPermission(user.role, "audit:manage");
  let rows: Awaited<ReturnType<typeof getEngagementList>> = [];
  let auditors: { id: string; name: string; email: string }[] = [];
  let queryFailed = false;
  try {
    const prisma = getPrisma();
    [rows, auditors] = await Promise.all([
      getEngagementList(prisma, user, filters),
      canManage
        ? prisma.user.findMany({
            where: {
              isActive: true,
              role: "AUDITOR",
              ...(user.role === "ADMINISTRATOR" ? {} : { id: user.id }),
            },
            orderBy: { name: "asc" },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
    ]);
  } catch (error) {
    logEngagementQueryFailure(error, "list");
    queryFailed = true;
  }
  if (queryFailed) {
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.auditWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.auditWorkflow.dataErrorBody}</p>
      </section>
    );
  }
  return (
    <EngagementList
      lang={lang}
      labels={dict.auditWorkflow}
      rows={rows}
      auditors={auditors}
      filters={filters}
      canManage={canManage}
      currentUserId={user.id}
      isAdministrator={user.role === "ADMINISTRATOR"}
    />
  );
}
