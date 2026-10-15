import { notFound } from "next/navigation";
import { loadLocale } from "@/i18n/server";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  getEngagementDetails,
  getSelectableRequirements,
  logEngagementQueryFailure,
} from "@/lib/audits/data";
import { EngagementDetails } from "./engagement-details";

export default async function EngagementPage({
  params,
}: PageProps<"/[lang]/audits/[engagementId]">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "audit:read");
  const { engagementId } = await params;
  const canManage = hasPermission(user.role, "audit:manage");
  let engagement: Awaited<ReturnType<typeof getEngagementDetails>> | undefined;
  let requirements: Awaited<ReturnType<typeof getSelectableRequirements>> = [];
  let auditors: { id: string; name: string; email: string }[] = [];
  try {
    const prisma = getPrisma();
    engagement = await getEngagementDetails(prisma, user, engagementId);
    if (engagement) {
      [requirements, auditors] = await Promise.all([
        canManage ? getSelectableRequirements(prisma, engagementId) : Promise.resolve([]),
        user.role === "ADMINISTRATOR"
          ? prisma.user.findMany({
              where: { isActive: true, role: "AUDITOR" },
              orderBy: { name: "asc" },
              select: { id: true, name: true, email: true },
            })
          : Promise.resolve([]),
      ]);
    }
  } catch (error) {
    logEngagementQueryFailure(error, "details");
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.auditWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.auditWorkflow.dataErrorBody}</p>
      </section>
    );
  }
  if (!engagement) notFound();
  return (
    <EngagementDetails
      lang={lang}
      labels={dict.auditWorkflow}
      verification={dict.verification}
      engagement={engagement}
      requirements={requirements}
      auditors={auditors}
      canManage={canManage}
      canAssignAuditors={user.role === "ADMINISTRATOR"}
    />
  );
}
