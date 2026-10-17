"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { EngagementActionState } from "./actions";
import { createEngagementAction } from "./actions";
import type { EngagementFilters } from "@/lib/audits/data";
import { ENGAGEMENT_STATUSES } from "@/lib/audits/workflow";

type Labels = Dictionary["auditWorkflow"];
type EngagementRow = Awaited<ReturnType<typeof import("@/lib/audits/data").getEngagementList>>[number];
type Auditor = { id: string; name: string; email: string };

export function EngagementList({
  lang,
  labels,
  rows,
  auditors,
  filters,
  canManage,
  currentUserId,
  isAdministrator,
}: {
  lang: string;
  labels: Labels;
  rows: EngagementRow[];
  auditors: Auditor[];
  filters: EngagementFilters;
  canManage: boolean;
  currentUserId: string;
  isAdministrator: boolean;
}) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{labels.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-ink-muted">{labels.description}</p>
        </div>
      </header>

      {canManage && (
        <CreateEngagementForm
          lang={lang}
          labels={labels}
          auditors={auditors}
          currentUserId={currentUserId}
          isAdministrator={isAdministrator}
        />
      )}

      <form action={`/${lang}/audits`} method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="engagement-search" className="mb-1 block text-sm font-medium text-ink">{labels.search}</label>
          <input id="engagement-search" name="q" type="search" defaultValue={filters.search} maxLength={120} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
        </div>
        <div>
          <label htmlFor="engagement-status" className="mb-1 block text-sm font-medium text-ink">{labels.filterStatus}</label>
          <select id="engagement-status" name="status" defaultValue={filters.status} className="rounded-md border border-line bg-surface px-3 py-2 text-ink">
            <option value="ALL">{labels.allStatuses}</option>
            {ENGAGEMENT_STATUSES.map((status) => (
              <option value={status} key={status}>{labels.statusLabels[status]}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white">{labels.searchButton}</button>
        {(filters.search || filters.status !== "ALL") && (
          <Link href={`/${lang}/audits`} className="rounded-md border border-line px-4 py-2 text-sm text-ink">{labels.clearFilters}</Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">
          {filters.search || filters.status !== "ALL" ? labels.noSearchResults : labels.noEngagements}
        </p>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => (
            <article key={row.id} className="rounded-lg border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/${lang}/audits/${row.id}`} className="text-lg font-semibold text-teal-strong underline-offset-2 hover:underline">
                    {row.title}
                  </Link>
                  <p className="mt-1 text-sm text-ink">{row.auditedOrganization || "—"}</p>
                </div>
                <span className="rounded-full bg-canvas px-3 py-1 text-xs font-medium text-ink">{labels.statusLabels[row.status as keyof typeof labels.statusLabels] ?? row.status}</span>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-ink-muted">{labels.period}</dt>
                  <dd className="mt-1 text-ink">{formatDate(row.periodStart, lang)} – {formatDate(row.periodEnd, lang)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{labels.assignedAuditor}</dt>
                  <dd className="mt-1 text-ink">{row.members.filter(({ user }) => user.role === "AUDITOR").map(({ user }) => user.name).join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{labels.updated}</dt>
                  <dd className="mt-1 text-ink">{formatDate(row.updatedAt, lang)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateEngagementForm({
  lang,
  labels,
  auditors,
  currentUserId,
  isAdministrator,
}: {
  lang: string;
  labels: Labels;
  auditors: Auditor[];
  currentUserId: string;
  isAdministrator: boolean;
}) {
  const [state, action, pending] = useActionState<EngagementActionState, FormData>(createEngagementAction, null);
  const choices = isAdministrator ? auditors : auditors.filter(({ id }) => id === currentUserId);
  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-4 text-lg font-semibold text-ink">{labels.createTitle}</summary>
      <form action={action} className="grid gap-4 border-t border-line p-5 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <Field label={labels.titleField} name="title" maxLength={200} required />
        <Field label={labels.organization} name="auditedOrganization" maxLength={200} required />
        <Field label={labels.startDate} name="periodStart" type="date" required />
        <Field label={labels.endDate} name="periodEnd" type="date" required />
        <div className="md:col-span-2">
          <label htmlFor="engagement-scope" className="mb-1 block text-sm font-medium text-ink">{labels.scope}</label>
          <textarea id="engagement-scope" name="scope" required minLength={2} maxLength={5000} rows={3} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
        </div>
        <div>
          <label htmlFor="assigned-auditor" className="mb-1 block text-sm font-medium text-ink">{labels.assignedAuditor}</label>
          <select id="assigned-auditor" name="assignedAuditorId" required disabled={choices.length === 0} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
            <option value="">—</option>
            {choices.map((auditor) => <option key={auditor.id} value={auditor.id}>{auditor.name} ({auditor.email})</option>)}
          </select>
          {choices.length === 0 && <p className="mt-1 text-sm text-warn-ink">{labels.noAuditors}</p>}
        </div>
        <div className="md:col-span-2">
          <Feedback state={state} labels={labels} />
          <button type="submit" disabled={pending || choices.length === 0} className="mt-3 rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {pending ? labels.creating : labels.create}
          </button>
        </div>
      </form>
    </details>
  );
}

function Field({
  label,
  name,
  type = "text",
  maxLength,
  required = false,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  maxLength?: number;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input id={name} name={name} type={type} maxLength={maxLength} required={required} defaultValue={defaultValue} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
    </div>
  );
}

export function Feedback({ state, labels }: { state: EngagementActionState; labels: Labels }) {
  if (!state) return null;
  if (state.error) {
    return <p role="alert" className="text-sm text-rose-800">{labels.errors[state.error]}</p>;
  }
  if (state.success) {
    return <p role="status" className="text-sm text-emerald-800">{labels.success[state.success]}</p>;
  }
  return null;
}

export function formatDate(date: Date, lang: string): string {
  return new Intl.DateTimeFormat(lang === "az" ? "az-AZ" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
