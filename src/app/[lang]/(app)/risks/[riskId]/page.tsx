import { notFound } from "next/navigation";
import { loadLocale } from "@/i18n/server";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { getRiskDetails, getRiskFormOptions } from "@/lib/risks/data";
import { RiskDetails } from "./risk-details";

export default async function RiskPage({ params }: PageProps<"/[lang]/risks/[riskId]">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "risks:read");
  const { riskId } = await params;
  let risk: Awaited<ReturnType<typeof getRiskDetails>> | undefined;
  let options: Awaited<ReturnType<typeof getRiskFormOptions>> | undefined;
  try {
    const prisma = getPrisma();
    [risk, options] = await Promise.all([getRiskDetails(prisma, riskId), getRiskFormOptions(prisma)]);
  } catch (error) {
    console.error("Risk detail query failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.riskWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.riskWorkflow.dataErrorBody}</p>
      </section>
    );
  }
  if (!risk || !options) notFound();
  const nowMs = new Date().getTime();
  return (
    <RiskDetails
      lang={lang}
      labels={dict.riskWorkflow}
      canManage={hasPermission(user.role, "risks:manage")}
      canAccept={hasPermission(user.role, "risks:accept")}
      assets={options.assets}
      controls={options.controls}
      risk={{
        ...risk,
        reviewDate: risk.reviewDate?.toISOString() ?? null,
        acceptedAt: risk.acceptedAt?.toISOString() ?? null,
        updatedAt: risk.updatedAt.toISOString(),
        actions: risk.actions.map((a) => ({
          ...a,
          dueDate: a.dueDate.toISOString(),
          overdue: (a.status === "OPEN" || a.status === "IN_PROGRESS") && a.dueDate.getTime() < nowMs,
          completedAt: a.completedAt?.toISOString() ?? null,
        })),
        history: risk.history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
      }}
    />
  );
}
