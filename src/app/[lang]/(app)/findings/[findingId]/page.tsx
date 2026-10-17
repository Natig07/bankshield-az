import { notFound } from "next/navigation";
import { loadLocale } from "@/i18n/server";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { getFindingDetails } from "@/lib/findings/data";
import { FindingDetails } from "./finding-details";

export default async function FindingPage({ params }: PageProps<"/[lang]/findings/[findingId]">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "findings:read");
  const { findingId } = await params;
  let finding: Awaited<ReturnType<typeof getFindingDetails>>;
  try {
    finding = await getFindingDetails(getPrisma(), user, findingId);
  } catch (error) {
    console.error("Finding detail query failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.findingWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.findingWorkflow.dataErrorBody}</p>
      </section>
    );
  }
  if (!finding) notFound();
  return (
    <FindingDetails
      lang={lang}
      labels={dict.findingWorkflow}
      canManage={hasPermission(user.role, "findings:manage")}
      canRemediate={hasPermission(user.role, "findings:remediate")}
      isCreator={finding.createdById === user.id}
      finding={{
        ...finding,
        updatedAtMs: finding.updatedAt.getTime(),
        updatedAt: finding.updatedAt.toISOString(),
        actions: finding.actions.map((a) => ({ ...a, dueDate: a.dueDate.toISOString() })),
        history: finding.history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
      }}
    />
  );
}
