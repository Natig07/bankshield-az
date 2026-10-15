import { Info, TriangleAlert } from "lucide-react";
import { VerificationBadge } from "@/components/status-badge";
import { loadLocale } from "@/i18n/server";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { getDashboardData, getDashboardState } from "@/lib/dashboard/data";
import type { DashboardData } from "@/lib/dashboard/data";

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <li className="rounded-lg border border-line bg-surface p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-ink">{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-muted">{detail}</p>}
    </li>
  );
}

function countsText(
  counts: Record<string, number>,
  labels: Record<string, string>,
  emptyLabel: string,
) {
  const entries = Object.entries(counts);
  return entries.length === 0
    ? emptyLabel
    : entries.map(([status, count]) => `${labels[status] ?? status}: ${count}`).join(" · ");
}

function DashboardMetrics({
  data,
  dict,
}: {
  data: DashboardData;
  dict: Awaited<ReturnType<typeof loadLocale>>["dict"];
}) {
  const d = dict.dashboard;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard
        label={d.metrics.sourcesPending}
        value={data.sourcesPending}
        detail={`${d.of} ${data.sourceCount}`}
      />
      <MetricCard label={d.metrics.verifiedRequirements} value={data.verifiedRequirements} />
      <MetricCard label={d.metrics.engagements} value={data.engagementCount} />
      <MetricCard
        label={d.metrics.assessmentStatuses}
        value={countsText(data.assessmentCounts, d.assessmentStatuses, d.emptyMetric)}
      />
      <MetricCard label={d.metrics.untested} value={data.untestedAssessments} />
      <MetricCard
        label={d.metrics.openFindings}
        value={countsText(data.openFindingCounts, d.severities, d.emptyMetric)}
      />
      <MetricCard label={d.metrics.evidence} value={data.evidenceCount} />
      <MetricCard label={d.metrics.overdueActions} value={data.overdueActions} />
      <MetricCard label={d.metrics.aiPending} value={data.pendingSuggestions} />
    </ul>
  );
}

export default async function DashboardPage({ params }: PageProps<"/[lang]">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "application:access");
  const d = dict.dashboard;
  const result = await getDashboardState(() =>
    getDashboardData(getPrisma(), user),
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{d.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{d.subtitle}</p>
      </header>

      {result.status === "error" ? (
        <aside
          role="alert"
          className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{d.errorTitle}</p>
            <p className="mt-1 text-sm">{d.errorBody}</p>
          </div>
        </aside>
      ) : (
        <>
          <aside
            role="note"
            className="flex gap-3 rounded-lg border border-line bg-surface p-4 text-ink-muted"
          >
            <Info aria-hidden className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm">{d.dataNotice}</p>
          </aside>

          <section aria-label={d.title}>
            <DashboardMetrics data={result.data} dict={dict} />
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line p-5">
              <h2 className="text-lg font-semibold text-ink">{d.sourcesTitle}</h2>
              <p className="mt-1 max-w-3xl text-sm text-ink-muted">{d.sourcesNote}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-canvas text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">{d.table.source}</th>
                    <th scope="col" className="px-5 py-3 font-medium">{d.table.issuer}</th>
                    <th scope="col" className="px-5 py-3 font-medium">{d.table.textLanguage}</th>
                    <th scope="col" className="px-5 py-3 font-medium">{d.table.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.data.sources.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-ink-muted">
                        {d.emptySources}
                      </td>
                    </tr>
                  ) : (
                    result.data.sources.map((source) => (
                      <tr key={source.code}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink">{source.title}</p>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-teal-strong underline underline-offset-2"
                          >
                            {dict.common.openSource}
                          </a>
                        </td>
                        <td className="px-5 py-3 text-ink-muted">{source.issuer}</td>
                        <td className="px-5 py-3 text-ink-muted">
                          {d.languageNames[source.language as keyof typeof d.languageNames] ?? source.language}
                        </td>
                        <td className="px-5 py-3">
                          <VerificationBadge
                            status={source.status}
                            label={dict.verification[source.status]}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
