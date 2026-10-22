import Link from "next/link";
import { loadLocale } from "@/i18n/server";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { getEngagementList, logEngagementQueryFailure } from "@/lib/audits/data";

export default async function Page({ params }: PageProps<"/[lang]/reports">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "reports:read");
  const labels = dict.reportWorkflow;
  let rows: Awaited<ReturnType<typeof getEngagementList>> = [];
  try {
    rows = await getEngagementList(getPrisma(), user, { search: "", status: "ALL" });
  } catch (error) {
    logEngagementQueryFailure(error, "reports");
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{labels.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{labels.dataErrorBody}</p>
      </section>
    );
  }
  return (
    <section>
      <h1 className="text-2xl font-semibold text-ink">{labels.title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">{labels.intro}</p>
      <h2 className="mt-6 text-lg font-semibold text-ink">{labels.selectEngagement}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-md border border-line bg-surface p-4 text-sm text-ink-muted">{labels.noEngagements}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium text-ink">{row.title}</p>
                <p className="text-sm text-ink-muted">
                  {row.auditedOrganization} · {dict.auditWorkflow.statusLabels[row.status as keyof typeof dict.auditWorkflow.statusLabels] ?? row.status}
                </p>
              </div>
              <Link className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white" href={`/${lang}/reports/${row.id}`}>
                {labels.openReport}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
