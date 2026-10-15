"use client";

import { useActionState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { ASSESSMENT_STATUSES, type AssessmentStatus, type VerificationStatus } from "@/lib/domain/enums";
import {
  approveAssessmentAction,
  createAssessmentRevisionAction,
  type ControlActionState,
} from "../../controls/actions";

type Labels = Dictionary["assessmentWorkflow"];
type Evidence = {
  id: string;
  controlId: string | null;
  originalName: string;
  reviewStatus: string;
  uploadedAt: string;
};
type ScopeItem = {
  id: string;
  control: { id: string; code: string; title: string; domain: string | null };
  requirement: {
    clauseId: string;
    topic: string | null;
    verificationStatus: string;
    version: { document: { code: string; title: string } };
  };
  assessments: {
    id: string;
    version: number;
    isCurrent: boolean;
    status: string;
    notApplicableReason: string | null;
    justification: string | null;
    approvedById: string | null;
    approvedAt: string | null;
    createdAt: string;
    evidenceLinks: {
      id: string;
      linkedAt: string;
      evidence: { id: string; originalName: string; reviewStatus: string };
      linkedBy: { name: string };
    }[];
  }[];
};

export function AssessmentWorkflow({
  lang,
  engagementId,
  labels,
  statuses,
  verification,
  scopeItems,
  evidence,
  canAssess,
}: {
  lang: string;
  engagementId: string;
  labels: Labels;
  statuses: Record<AssessmentStatus, string>;
  verification: Record<VerificationStatus, string>;
  scopeItems: ScopeItem[];
  evidence: Evidence[];
  canAssess: boolean;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-ink">{labels.title}</h2>
      {scopeItems.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface p-5 text-sm text-ink-muted">{labels.emptyScope}</p>
      ) : (
        scopeItems.map((scopeItem) => {
          const eligibleEvidence = evidence.filter((record) => record.controlId === null || record.controlId === scopeItem.control.id);
          return (
            <article key={scopeItem.id} className="rounded-lg border border-line bg-surface p-5">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-ink">{scopeItem.control.code} · {scopeItem.control.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {scopeItem.requirement.version.document.code} · {scopeItem.requirement.clauseId}
                    {scopeItem.requirement.topic ? ` · ${scopeItem.requirement.topic}` : ""}
                  </p>
                  <p className="text-xs text-ink-muted">{scopeItem.requirement.version.document.title} · {scopeItem.control.domain || "—"}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${scopeItem.requirement.verificationStatus === "VERIFIED" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                  {verification[scopeItem.requirement.verificationStatus as VerificationStatus] ?? scopeItem.requirement.verificationStatus}
                </span>
              </header>
              {scopeItem.requirement.verificationStatus !== "VERIFIED" && (
                <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{labels.pendingRequirement}</p>
              )}

              {scopeItem.assessments.length === 0 ? (
                <p className="mt-4 text-sm text-ink-muted">{labels.noHistory}</p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {scopeItem.assessments.map((assessment) => (
                    <li key={assessment.id} className={`rounded-md border p-4 ${assessment.isCurrent ? "border-teal-700 bg-teal-50/30" : "border-line bg-canvas"}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">
                          {labels.revision} {assessment.version} · {statuses[assessment.status as AssessmentStatus] ?? assessment.status}
                        </span>
                        {assessment.isCurrent && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-900">{labels.current}</span>}
                        <span className="text-xs text-ink-muted">{formatDate(assessment.createdAt, lang)}</span>
                      </div>
                      {assessment.status === "NOT_APPLICABLE" && assessment.notApplicableReason && (
                        <p className="mt-2 text-sm text-ink">{labels.notApplicableReason}: {assessment.notApplicableReason}</p>
                      )}
                      {assessment.approvedAt ? (
                        <p className="mt-2 text-sm text-emerald-800">
                          {labels.approved} · {formatDate(assessment.approvedAt, lang)}
                          {assessment.justification ? ` — ${assessment.justification}` : ""}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-ink-muted">{labels.notApproved}</p>
                      )}
                      {assessment.evidenceLinks.length === 0 ? (
                        <p className="mt-2 text-xs text-ink-muted">{labels.noAssessmentEvidence}</p>
                      ) : (
                        <ul className="mt-2 space-y-1 text-sm text-ink">
                          {assessment.evidenceLinks.map(({ id, evidence: linkedEvidence }) => (
                            <li key={id}>{linkedEvidence.originalName} <span className="text-xs text-ink-muted">({linkedEvidence.reviewStatus})</span></li>
                          ))}
                        </ul>
                      )}
                      {canAssess && assessment.isCurrent && !assessment.approvedAt && (
                        <ApproveForm
                          lang={lang}
                          engagementId={engagementId}
                          assessmentId={assessment.id}
                          labels={labels}
                        />
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {canAssess && (
                <RevisionForm
                  lang={lang}
                  engagementId={engagementId}
                  scopeItem={scopeItem}
                  currentStatus={scopeItem.assessments.find((assessment) => assessment.isCurrent)?.status}
                  eligibleEvidence={eligibleEvidence}
                  labels={labels}
                  statuses={statuses}
                />
              )}
            </article>
          );
        })
      )}
    </section>
  );
}

function RevisionForm({
  lang,
  engagementId,
  scopeItem,
  currentStatus,
  eligibleEvidence,
  labels,
  statuses,
}: {
  lang: string;
  engagementId: string;
  scopeItem: ScopeItem;
  currentStatus?: string;
  eligibleEvidence: Evidence[];
  labels: Labels;
  statuses: Record<AssessmentStatus, string>;
}) {
  const [state, action, pending] = useActionState<ControlActionState, FormData>(createAssessmentRevisionAction, null);
  return (
    <details className="mt-4 border-t border-line pt-4">
      <summary className="cursor-pointer text-sm font-medium text-teal-strong">{labels.newRevision}</summary>
      <form action={action} className="mt-3 grid gap-3">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="engagementId" value={engagementId} />
        <input type="hidden" name="scopeItemId" value={scopeItem.id} />
        <label className="text-sm font-medium text-ink">
          {labels.status}
          <select name="status" defaultValue={currentStatus ?? "NOT_TESTED"} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal">
            {ASSESSMENT_STATUSES.map((status) => <option key={status} value={status}>{statuses[status]}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">
          {labels.notApplicableReason}
          <textarea name="notApplicableReason" maxLength={2000} rows={2} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal" />
        </label>
        <label className="text-sm font-medium text-ink">
          {labels.evidence}
          <select multiple name="evidenceIds" disabled={eligibleEvidence.length === 0} className="mt-1 min-h-24 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal">
            {eligibleEvidence.map((record) => (
              <option key={record.id} value={record.id}>{record.originalName} · {record.reviewStatus}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-ink-muted">{eligibleEvidence.length ? labels.evidenceHint : labels.noEvidence}</p>
        <Feedback state={state} labels={labels} />
        <button type="submit" disabled={pending} className="justify-self-start rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? labels.saving : labels.saveRevision}
        </button>
      </form>
    </details>
  );
}

function ApproveForm({
  lang,
  engagementId,
  assessmentId,
  labels,
}: {
  lang: string;
  engagementId: string;
  assessmentId: string;
  labels: Labels;
}) {
  const [state, action, pending] = useActionState<ControlActionState, FormData>(approveAssessmentAction, null);
  return (
    <form action={action} className="mt-4 border-t border-line pt-3">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="engagementId" value={engagementId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <label className="block text-sm font-medium text-ink">
        {labels.justification}
        <textarea name="justification" required minLength={10} maxLength={2000} rows={2} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal" />
      </label>
      <Feedback state={state} labels={labels} />
      <button type="submit" disabled={pending} className="mt-3 rounded-md border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60">
        {pending ? labels.approving : labels.approveAssessment}
      </button>
    </form>
  );
}

function Feedback({ state, labels }: { state: ControlActionState; labels: Labels }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="mt-2 text-sm text-rose-700">{labels.errors[state.error]}</p>;
  if (state.success) return <p role="status" className="mt-2 text-sm text-emerald-800">{labels.success[state.success]}</p>;
  return null;
}

function formatDate(value: string, lang: string) {
  return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}
