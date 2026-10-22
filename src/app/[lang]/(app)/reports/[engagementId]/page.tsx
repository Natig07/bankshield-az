import Link from "next/link";
import { notFound } from "next/navigation";
import { loadLocale } from "@/i18n/server";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { getEngagementReport } from "@/lib/reports/data";
import { listReportRecords } from "@/lib/reports/service";
import { PrintButton } from "./print-button";
import { RecordButton } from "./record-button";

const card = "mt-6 rounded-lg border border-line bg-surface p-5 break-inside-avoid";
const th = "px-2 py-1 text-left font-medium text-ink-muted";
const td = "px-2 py-1 align-top text-ink";

export default async function ReportPage({ params }: PageProps<"/[lang]/reports/[engagementId]">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "reports:read");
  const { engagementId } = await params;
  const l = dict.reportWorkflow;
  let report: Awaited<ReturnType<typeof getEngagementReport>>;
  let records: Awaited<ReturnType<typeof listReportRecords>> = [];
  try {
    const prisma = getPrisma();
    report = await getEngagementReport(prisma, user, engagementId);
    if (report) records = await listReportRecords(prisma, user, engagementId);
  } catch (error) {
    console.error("Report query failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{l.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{l.dataErrorBody}</p>
      </section>
    );
  }
  if (!report) notFound();
  const e = report.engagement;
  const statusLabel = dict.auditWorkflow.statusLabels[e.status as keyof typeof dict.auditWorkflow.statusLabels] ?? e.status;
  const assessmentLabel = (s: string) => dict.dashboard.assessmentStatuses[s as keyof typeof dict.dashboard.assessmentStatuses] ?? s;
  const severityLabel = (s: string) => dict.dashboard.severities[s as keyof typeof dict.dashboard.severities] ?? s;
  const verificationLabel = (s: string) => dict.verification[s as keyof typeof dict.verification] ?? s;
  const reviewLabel = (s: string) => dict.evidenceWorkflow.reviewStatuses[s as keyof typeof dict.evidenceWorkflow.reviewStatuses] ?? s;
  const findingStatus = (s: string) => dict.findingWorkflow.statuses[s as keyof typeof dict.findingWorkflow.statuses] ?? s;
  const actionStatus = (s: string) => dict.findingWorkflow.actionStatuses[s as keyof typeof dict.findingWorkflow.actionStatuses] ?? s;
  const riskStatus = (s: string) => dict.riskWorkflow.statuses[s as keyof typeof dict.riskWorkflow.statuses] ?? s;
  const score = (s: { inherent: number | null; residual: number | null; band: string | null }) =>
    s.inherent == null && s.residual == null
      ? l.notScored
      : `${l.inherent}: ${s.inherent ?? "–"} · ${l.residual}: ${s.residual ?? "–"}${s.band ? ` (${severityLabel(s.band)})` : ""}`;
  const assessed = report.assessments.filter((a) => a.status !== "NOT_TESTED").length;
  const openFindings = report.findings.filter((f) => f.status !== "CLOSED").length;
  const canRecord = hasPermission(user.role, "reports:manage");

  return (
    <article>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link className="text-sm text-ink underline" href={`/${lang}/reports`}>{l.back}</Link>
        <PrintButton label={l.print} />
      </div>
      <header className="mt-4">
        <p className="text-sm text-ink-muted">{l.reportTitle}</p>
        <h1 className="text-2xl font-semibold text-ink">{e.title}</h1>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-muted">{l.organization}</dt><dd className="text-ink">{e.auditedOrganization || "–"}</dd></div>
          <div><dt className="text-ink-muted">{l.period}</dt><dd className="text-ink">{e.periodStart} – {e.periodEnd}</dd></div>
          <div><dt className="text-ink-muted">{l.status}</dt><dd className="text-ink">{statusLabel}</dd></div>
          <div><dt className="text-ink-muted">{l.preparedBy}</dt><dd className="text-ink">{e.preparedBy}</dd></div>
          <div><dt className="text-ink-muted">{l.approvedBy}</dt><dd className="text-ink">{e.approvedBy ? `${e.approvedBy}${e.approvedAt ? `, ${e.approvedAt.slice(0, 10)}` : ""}` : l.notApproved}</dd></div>
          <div className="sm:col-span-2"><dt className="text-ink-muted">{l.scope}</dt><dd className="text-ink">{e.scope}</dd></div>
        </dl>
      </header>

      <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950 break-inside-avoid" aria-labelledby="limitations">
        <h2 id="limitations" className="text-lg font-semibold">{l.limitationsTitle}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {l.limitations.map((text) => <li key={text}>{text}</li>)}
        </ul>
      </section>

      <section className={card} aria-labelledby="summary">
        <h2 id="summary" className="text-lg font-semibold text-ink">{l.summaryTitle}</h2>
        <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-ink-muted">{l.summaryAssessed}</dt><dd className="text-xl font-semibold text-ink">{assessed} / {report.assessments.length}</dd></div>
          <div><dt className="text-ink-muted">{l.summaryFindings}</dt><dd className="text-xl font-semibold text-ink">{openFindings} / {report.findings.length}</dd></div>
          <div><dt className="text-ink-muted">{l.summaryRisks}</dt><dd className="text-xl font-semibold text-ink">{report.risks.length}</dd></div>
          <div><dt className="text-ink-muted">{l.summaryEvidence}</dt><dd className="text-xl font-semibold text-ink">{report.evidenceSummary.total}</dd></div>
        </dl>
      </section>

      <section className={card} aria-labelledby="requirements">
        <h2 id="requirements" className="text-lg font-semibold text-ink">{l.requirementsTitle}</h2>
        {report.requirements.length === 0 ? <p className="mt-2 text-sm text-ink-muted">{l.noRequirements}</p> : (
          <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className={th}>{l.clause}</th><th className={th}>{l.topic}</th><th className={th}>{l.source}</th><th className={th}>{l.verification}</th></tr></thead>
            <tbody>{report.requirements.map((r) => (
              <tr key={`${r.source}-${r.clauseId}`} className="border-t border-line">
                <td className={td}>{r.clauseId}</td>
                <td className={td}>{r.topic}{r.decisionNote ? <span className="block text-xs text-ink-muted">{l.decisionNote}: {r.decisionNote}</span> : null}</td>
                <td className={td}>{r.source} · {r.versionLabel}</td>
                <td className={td}>{verificationLabel(r.verificationStatus)}{r.unverifiedAcknowledged ? <span className="block text-xs text-ink-muted">{l.acknowledged}</span> : null}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>

      <section className={card} aria-labelledby="assessments">
        <h2 id="assessments" className="text-lg font-semibold text-ink">{l.assessmentsTitle}</h2>
        {report.assessments.length === 0 ? <p className="mt-2 text-sm text-ink-muted">{l.noAssessments}</p> : (
          <ul className="mt-3 space-y-4">
            {report.assessments.map((a) => (
              <li key={`${a.controlCode}-${a.clauseId}`} className="rounded-md border border-line p-3 text-sm break-inside-avoid">
                <p className="font-medium text-ink">{a.controlCode} · {a.controlTitle} <span className="font-normal text-ink-muted">({l.clause} {a.clauseId})</span></p>
                <p className="mt-1 text-ink">{l.result}: <strong>{assessmentLabel(a.status)}</strong>{a.version ? ` · ${l.revision} ${a.version}` : ""}</p>
                {a.justification ? <p className="mt-1 text-ink">{l.justification}: {a.justification}</p> : null}
                {a.notApplicableReason ? <p className="mt-1 text-ink">{l.reason}: {a.notApplicableReason}</p> : null}
                {a.approvedBy ? <p className="mt-1 text-ink-muted">{l.approvedByAssessment}: {a.approvedBy}{a.approvedAt ? `, ${a.approvedAt.slice(0, 10)}` : ""}</p> : null}
                <p className="mt-2 text-ink-muted">{l.evidenceRefs}:</p>
                {a.evidence.length === 0 ? <p className="text-ink-muted">{l.noEvidence}</p> : (
                  <ul className="list-disc pl-5">{a.evidence.map((ev) => (
                    <li key={ev.sha256} className="text-ink">{ev.name} ({reviewLabel(ev.reviewStatus)}) <span className="break-all font-mono text-xs text-ink-muted">{l.sha256}: {ev.sha256}</span></li>
                  ))}</ul>
                )}
              </li>))}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="findings">
        <h2 id="findings" className="text-lg font-semibold text-ink">{l.findingsTitle}</h2>
        {report.findings.length === 0 ? <p className="mt-2 text-sm text-ink-muted">{l.noFindings}</p> : (
          <ul className="mt-3 space-y-4">
            {report.findings.map((f, index) => (
              <li key={`${f.title}-${index}`} className="rounded-md border border-line p-3 text-sm break-inside-avoid">
                <p className="font-medium text-ink">{f.title}{f.clauseId ? <span className="font-normal text-ink-muted"> ({l.clause} {f.clauseId})</span> : null}</p>
                <p className="text-ink">{l.severity}: {severityLabel(f.severity)} · {findingStatus(f.status)} · {score(f.score)}</p>
                {f.actions.length === 0 ? <p className="mt-1 text-ink-muted">{l.noActions}</p> : (
                  <ul className="mt-1 list-disc pl-5">{f.actions.map((action, i) => (
                    <li key={i} className="text-ink">{action.plan} — {l.owner}: {action.owner}, {l.dueDate}: {action.dueDate}, {actionStatus(action.status)}</li>
                  ))}</ul>
                )}
              </li>))}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="risks">
        <h2 id="risks" className="text-lg font-semibold text-ink">{l.risksTitle}</h2>
        {report.risks.length === 0 ? <p className="mt-2 text-sm text-ink-muted">{l.noRisks}</p> : (
          <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className={th}>{l.riskCode}</th><th className={th}>{l.riskStatus}</th><th className={th}>{l.linkedControls}</th><th className={th}>{l.band}</th></tr></thead>
            <tbody>{report.risks.map((r) => (
              <tr key={r.code} className="border-t border-line">
                <td className={td}>{r.code} · {r.title}</td>
                <td className={td}>{riskStatus(r.status)}</td>
                <td className={td}>{r.controlCodes.join(", ")}</td>
                <td className={td}>{score(r.score)}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>

      <section className={card} aria-labelledby="evidence">
        <h2 id="evidence" className="text-lg font-semibold text-ink">{l.evidenceTitle}</h2>
        <p className="mt-2 text-sm text-ink">{l.evidenceTotal}: {report.evidenceSummary.total}
          {Object.entries(report.evidenceSummary.byReviewStatus).map(([status, count]) => ` · ${reviewLabel(status)}: ${count}`).join("")}</p>
      </section>

      <section className={card} aria-labelledby="integrity">
        <h2 id="integrity" className="text-lg font-semibold text-ink">{l.integrityTitle}</h2>
        <p className="mt-2 text-sm text-ink-muted">{l.fingerprintNote}</p>
        <p className="mt-2 text-sm text-ink">{l.fingerprint}:</p>
        <p className="break-all font-mono text-xs text-ink">{report.contentSha256}</p>
      </section>

      <section className={`${card} print:hidden`} aria-labelledby="log">
        <h2 id="log" className="text-lg font-semibold text-ink">{l.recordTitle}</h2>
        {canRecord ? <div className="mt-3"><RecordButton lang={lang} engagementId={engagementId} labels={l} /></div> : null}
        {records.length === 0 ? <p className="mt-3 text-sm text-ink-muted">{l.noRecords}</p> : (
          <ul className="mt-3 space-y-1 text-sm">{records.map((r) => (
            <li key={r.id} className="text-ink">
              {r.generatedAt.toISOString().slice(0, 16).replace("T", " ")} · {l.recordedBy}: {r.generatedBy} · {r.locale.toUpperCase()} ·{" "}
              <span className="font-mono text-xs">{r.contentSha256.slice(0, 12)}</span> · {r.contentSha256 === report.contentSha256 ? l.matchesCurrent : l.differsCurrent}
            </li>))}</ul>
        )}
      </section>
    </article>
  );
}
