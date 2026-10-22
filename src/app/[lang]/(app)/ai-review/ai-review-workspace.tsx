"use client";

import { useActionState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { getAiReviewData, SuggestionFilter } from "@/lib/ai-review/data";
import { reviewSuggestionAction, runAiReviewAction, type AiReviewActionState } from "./actions";
import { SubmitButton } from "@/components/submit-button";

type Labels = Dictionary["aiReviewWorkflow"];
type Data = Awaited<ReturnType<typeof getAiReviewData>>;
type Suggestion = Data["suggestions"][number];

const FILTERS: SuggestionFilter[] = ["PENDING_REVIEW", "ACCEPTED", "REJECTED", "ALL"];

function dateTime(value: string, lang: string) {
  return new Intl.DateTimeFormat(lang === "az" ? "az-AZ" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

function Feedback({ state, labels }: { state: AiReviewActionState; labels: Labels }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-rose-800">{labels.errors[state.error]}</p>;
  if (state.success) return <p role="status" className="text-sm text-emerald-800">{labels.success[state.success]}</p>;
  return null;
}

export function AiReviewWorkspace({
  lang,
  title,
  description,
  labels,
  data,
  filter,
  canViewAnalysis,
  canManage,
  geminiConfigured,
}: {
  lang: string;
  title: string;
  description: string;
  labels: Labels;
  data: Data;
  filter: SuggestionFilter;
  canViewAnalysis: boolean;
  canManage: boolean;
  geminiConfigured: boolean;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">{description}</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <aside className="rounded-lg border border-line bg-surface p-4 text-sm" aria-labelledby="ai-privacy-title">
          <h2 id="ai-privacy-title" className="font-semibold text-ink">{labels.privacyTitle}</h2>
          <p className="mt-1 text-ink-muted">{labels.privacyBody}</p>
        </aside>
        <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" aria-labelledby="ai-disclaimer-title">
          <h2 id="ai-disclaimer-title" className="font-semibold">{labels.disclaimerTitle}</h2>
          <p className="mt-1">{labels.disclaimerBody}</p>
        </aside>
      </div>

      {!canViewAnalysis ? (
        <p role="status" className="mt-6 rounded-lg border border-line bg-surface p-5 text-sm text-ink-muted">{labels.noAnalysisAccess}</p>
      ) : data.engagements.length === 0 ? (
        <p role="status" className="mt-6 rounded-lg border border-dashed border-line bg-surface p-5 text-sm text-ink-muted">{labels.noEngagements}</p>
      ) : (
        <>
          <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="ai-engagement" className="mb-1 block text-sm font-medium text-ink">{labels.selectEngagement}</label>
              <select id="ai-engagement" name="engagement" defaultValue={data.selectedId ?? ""} className="min-w-64 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
                <option value="">—</option>
                {data.engagements.map((item) => (
                  <option key={item.id} value={item.id}>{item.title} ({item.auditedOrganization})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ai-filter" className="mb-1 block text-sm font-medium text-ink">{labels.filterLabel}</label>
              <select id="ai-filter" name="status" defaultValue={filter} className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
                {FILTERS.map((value) => <option key={value} value={value}>{labels.filters[value]}</option>)}
              </select>
            </div>
            <SubmitButton className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink">{labels.openEngagement}</SubmitButton>
          </form>

          {!data.selectedId ? (
            <p role="status" className="mt-6 text-sm text-ink-muted">{labels.chooseEngagement}</p>
          ) : (
            <div className="mt-6 grid gap-6">
              <GenerateForm lang={lang} engagementId={data.selectedId} labels={labels} canManage={canManage} geminiConfigured={geminiConfigured} />
              {data.lastRun && (
                <p className="text-sm text-ink-muted">
                  {labels.lastRun}: {dateTime(data.lastRun.createdAt.toISOString(), lang)} · {labels.modelLabel}: {data.lastRun.model} ·{" "}
                  {data.lastRun.status === "SUCCEEDED"
                    ? `${labels.runSucceeded}, ${data.lastRun.suggestionCount} ${labels.suggestionsCreated}`
                    : `${labels.runFailed}${data.lastRun.errorCode && data.lastRun.errorCode in labels.errors ? ` — ${labels.errors[data.lastRun.errorCode as keyof Labels["errors"]]}` : ""}`}
                </p>
              )}
              <ul className="flex flex-wrap gap-2 text-sm" aria-label={labels.filterLabel}>
                {(["PENDING_REVIEW", "ACCEPTED", "REJECTED"] as const).map((status) => (
                  <li key={status} className="rounded-full border border-line bg-surface px-3 py-1 text-ink">{labels.statuses[status]}: {data.counts[status]}</li>
                ))}
              </ul>
              {data.suggestions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line bg-surface p-6">
                  <p className="text-sm font-medium text-ink">{labels.emptyTitle}</p>
                  <p className="mt-1 text-sm text-ink-muted">{labels.emptyBody}</p>
                </div>
              ) : (
                <ul className="grid gap-4">
                  {data.suggestions.map((suggestion) => (
                    <SuggestionCard key={suggestion.id} suggestion={suggestion} lang={lang} labels={labels} canManage={canManage} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function GenerateForm({ lang, engagementId, labels, canManage, geminiConfigured }: { lang: string; engagementId: string; labels: Labels; canManage: boolean; geminiConfigured: boolean }) {
  const [state, action, pending] = useActionState<AiReviewActionState, FormData>(runAiReviewAction, null);
  if (!canManage) return <p role="status" className="text-sm text-ink-muted">{labels.cannotGenerate}</p>;
  return (
    <form action={action} className="grid gap-3 rounded-lg border border-line bg-surface p-4">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="engagementId" value={engagementId} />
      {!geminiConfigured && <p role="alert" className="text-sm text-rose-800">{labels.notConfigured}</p>}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="consent" required disabled={!geminiConfigured || pending} className="mt-1" />
        <span>{labels.consentLabel}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={!geminiConfigured || pending} className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? labels.generating : labels.generate}
        </SubmitButton>
        <div aria-live="polite"><Feedback state={state} labels={labels} /></div>
      </div>
    </form>
  );
}

function SuggestionCard({ suggestion, lang, labels, canManage }: { suggestion: Suggestion; lang: string; labels: Labels; canManage: boolean }) {
  const targetType = suggestion.targetType as keyof Labels["targetTypes"];
  const kind = suggestion.kind as keyof Labels["kinds"];
  const confidence = suggestion.confidence as keyof Labels["confidenceLevels"];
  const status = suggestion.reviewStatus as keyof Labels["statuses"];
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-ink">{labels.statuses[status] ?? suggestion.reviewStatus}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-ink">{labels.kinds[kind] ?? suggestion.kind}</span>
      </div>
      <h3 className="mt-2 font-semibold text-ink">{suggestion.title}</h3>

      <div className="mt-3 rounded-md border border-line p-3 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{labels.sourceRecord}</p>
        <p className="mt-1 text-ink">{labels.targetTypes[targetType] ?? suggestion.targetType}: {suggestion.targetLabel ?? "—"}</p>
        {suggestion.requirementClause && (
          <p className="text-ink-muted">
            {labels.requirement}: {suggestion.requirementClause}
            {suggestion.requirementUnverified ? ` — ${labels.requirementUnverified}` : ""}
          </p>
        )}
      </div>

      <div className="mt-3 rounded-md border border-dashed border-line p-3 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{labels.hypothesis} · {labels.generatedBy} {suggestion.model} · {dateTime(suggestion.createdAt, lang)}</p>
        <h4 className="mt-2 font-medium text-ink">{labels.reasoning}</h4>
        <p className="whitespace-pre-line text-ink">{suggestion.reasoning}</p>
        <h4 className="mt-2 font-medium text-ink">{labels.recommendedActions}</h4>
        <ul className="list-disc pl-5 text-ink">{suggestion.recommendedActions.map((item, index) => <li key={index}>{item}</li>)}</ul>
        <h4 className="mt-2 font-medium text-ink">{labels.verificationSteps}</h4>
        <ul className="list-disc pl-5 text-ink">{suggestion.verificationSteps.map((item, index) => <li key={index}>{item}</li>)}</ul>
        <p className="mt-2 text-ink-muted">{labels.confidence}: {labels.confidenceLevels[confidence] ?? suggestion.confidence}</p>
        <p className="text-ink-muted">{labels.limitations}: {suggestion.limitations}</p>
      </div>

      {suggestion.reviewStatus === "PENDING_REVIEW" ? (
        canManage && <ReviewForm suggestionId={suggestion.id} lang={lang} labels={labels} />
      ) : (
        <p className="mt-3 text-sm text-ink-muted">
          {labels.reviewedBy}: {suggestion.reviewedByName ?? "—"}
          {suggestion.reviewedAt ? ` · ${dateTime(suggestion.reviewedAt, lang)}` : ""}
          {suggestion.reviewNote ? ` · ${suggestion.reviewNote}` : ""}
        </p>
      )}
    </li>
  );
}

function ReviewForm({ suggestionId, lang, labels }: { suggestionId: string; lang: string; labels: Labels }) {
  const [state, action, pending] = useActionState<AiReviewActionState, FormData>(reviewSuggestionAction, null);
  const noteId = `note-${suggestionId}`;
  return (
    <form action={action} className="mt-3 grid gap-2 border-t border-line pt-3">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <label htmlFor={noteId} className="text-sm font-medium text-ink">{labels.reviewNote}</label>
      <textarea id={noteId} name="note" rows={2} maxLength={1000} aria-describedby={`${noteId}-hint`} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />
      <p id={`${noteId}-hint`} className="text-xs text-ink-muted">{labels.reviewNoteHint} {labels.acceptNotice}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="decision" value="ACCEPTED" disabled={pending} className="rounded-md bg-navy-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? labels.reviewing : labels.accept}</SubmitButton>
        <SubmitButton name="decision" value="REJECTED" disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-60">{labels.reject}</SubmitButton>
        <div aria-live="polite"><Feedback state={state} labels={labels} /></div>
      </div>
    </form>
  );
}
