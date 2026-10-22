"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FINDING_STATUSES, SEVERITIES } from "@/lib/domain/enums";
import { createFindingAction, type FindingActionState } from "./actions";
import { Feedback, FindingFields, input, primary, severityClass, type Labels } from "./finding-fields";
import { SubmitButton } from "@/components/submit-button";

type Row = {
  id: string; title: string; severity: string; status: string; updatedAt: string;
  engagement: { id: string; title: string }; requirement: { clauseId: string } | null;
  totalActions: number; openActions: number; overdueActions: number;
};

export function FindingRegister({ lang, labels, filters, canManage, summary, engagements, findings }: {
  lang: string; labels: Labels; filters: { search: string; status: string; severity: string }; canManage: boolean;
  summary: { open: number; severities: Record<string, number>; overdueActions: number };
  engagements: EngagementOption[]; findings: Row[];
}) {
  const filtered = filters.search || filters.status !== "ALL" || filters.severity !== "ALL";
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{labels.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">{labels.description}</p>
      </header>

      <section aria-labelledby="finding-summary" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <h2 id="finding-summary" className="sr-only">{labels.summaryTitle}</h2>
        <Tile label={labels.openFindings} value={summary.open} />
        {SEVERITIES.map((s) => <Tile key={s} label={labels.severities[s]} value={summary.severities[s] ?? 0} tone={severityClass(s)} />)}
        <Tile label={labels.overdueActions} value={summary.overdueActions} />
      </section>

      {canManage && <CreateFinding lang={lang} labels={labels} engagements={engagements} />}

      <form action={`/${lang}/findings`} method="get" className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-medium text-ink">{labels.search}
          <input name="q" type="search" maxLength={120} defaultValue={filters.search} className={input} />
        </label>
        <label className="text-sm font-medium text-ink">{labels.filterStatus}
          <select name="status" defaultValue={filters.status} className={input}>
            <option value="ALL">{labels.all}</option>
            {FINDING_STATUSES.map((s) => <option key={s} value={s}>{labels.statuses[s]}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">{labels.filterSeverity}
          <select name="severity" defaultValue={filters.severity} className={input}>
            <option value="ALL">{labels.all}</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{labels.severities[s]}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <SubmitButton className={primary}>{labels.apply}</SubmitButton>
          {filtered && <Link href={`/${lang}/findings`} className="rounded-md border border-line px-4 py-2 text-sm text-ink">{labels.clear}</Link>}
        </div>
      </form>

      {findings.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">{filtered ? labels.noResults : labels.noFindings}</p>
      ) : (
        <ul className="grid gap-3">
          {findings.map((f) => (
            <li key={f.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-ink-muted">{f.engagement.title}{f.requirement ? ` · ${f.requirement.clauseId}` : ""}</p>
                  <Link href={`/${lang}/findings/${f.id}`} className="break-words text-lg font-semibold text-teal-strong underline-offset-2 hover:underline">{f.title}</Link>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityClass(f.severity)}`}>{labels.severities[f.severity as keyof typeof labels.severities]}</span>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                {labels.statuses[f.status as keyof typeof labels.statuses]} · {labels.fields.actions}: {f.openActions}/{f.totalActions}
                {f.overdueActions > 0 && <span className="ml-1 font-semibold text-rose-800">· {f.overdueActions} {labels.overdue}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-lg border border-line p-3 ${tone ?? "bg-surface"}`}>
      <p className="text-xs">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

type EngagementOption = { id: string; title: string; requirements: { id: string; clauseId: string; topic: string | null }[] };

function CreateFinding({ lang, labels, engagements }: { lang: string; labels: Labels; engagements: EngagementOption[] }) {
  const [selectedId, setSelectedId] = useState(engagements[0]?.id ?? "");
  const [state, action, pending] = useActionState<FindingActionState, FormData>(createFindingAction, null);
  if (engagements.length === 0) return <p className="rounded-md border border-line bg-surface p-4 text-sm text-ink-muted">{labels.noEngagements}</p>;
  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-4 text-lg font-semibold text-ink">{labels.createTitle}</summary>
      <form action={action} className="grid gap-4 border-t border-line p-5 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <label className="text-sm font-medium text-ink md:col-span-2">{labels.engagement}
          <select name="engagementId" required value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className={input}>
            {engagements.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </label>
        <FindingFields key={selectedId} labels={labels} requirements={engagements.find((e) => e.id === selectedId)?.requirements ?? []} />
        <div className="md:col-span-2">
          <Feedback state={state} labels={labels} />
          <SubmitButton disabled={pending} className={`mt-3 ${primary}`}>{pending ? labels.creating : labels.create}</SubmitButton>
        </div>
      </form>
    </details>
  );
}
