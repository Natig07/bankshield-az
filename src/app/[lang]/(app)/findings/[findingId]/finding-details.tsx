"use client";

import Link from "next/link";
import { useActionState } from "react";
import { canAddRemediationAction, canTransitionFinding, isFindingEditable } from "@/lib/findings/workflow";
import { FINDING_STATUSES } from "@/lib/domain/enums";
import {
  addRemediationActionAction,
  transitionFindingAction,
  updateFindingAction,
  updateRemediationStatusAction,
  type FindingActionState,
} from "../actions";
import { Feedback, FindingFields, input, primary, secondary, severityClass, type Labels } from "../finding-fields";
import { formatDate } from "@/lib/format/date";
import { EngagementLockNotice } from "@/components/engagement-lock-notice";
import { engagementAllows } from "@/lib/audits/workflow";
import { SubmitButton } from "@/components/submit-button";

type Finding = {
  id: string; title: string; description: string; severity: string; status: string; requirementId: string | null;
  inherentLikelihood: number | null; inherentImpact: number | null; residualLikelihood: number | null; residualImpact: number | null;
  inherentScore: number | null; residualScore: number | null; updatedAtMs: number; updatedAt: string;
  engagement: { id: string; title: string; status: string };
  requirement: { clauseId: string; topic: string | null } | null;
  requirements: { id: string; clauseId: string; topic: string | null }[];
  evidence: { id: string; originalName: string }[];
  actions: { id: string; ownerName: string; actionPlan: string; dueDate: string; status: string; completedAt: Date | null; completionEvidenceId: string | null; overdue: boolean }[];
  history: { id: string; changeNote: string | null; createdAt: string }[];
};

const fmt = formatDate;

export function FindingDetails({ lang, labels, canManage, canRemediate, isCreator, finding, lockMessages }: {
  lang: string; labels: Labels; canManage: boolean; canRemediate: boolean; isCreator: boolean; finding: Finding; lockMessages: Record<string, string>;
}) {
  // Mirrors the server-side engagement gates; the server remains the authority.
  const engagementStatus = finding.engagement.status;
  const findingsOpen = engagementAllows(engagementStatus, "manageFindings");
  const remediationOpen = engagementAllows(engagementStatus, "manageRemediation");
  const editable = isFindingEditable(finding.status) && findingsOpen;
  return (
    <div className="space-y-6">
      <Link href={`/${lang}/findings`} className="text-sm text-teal-strong underline-offset-2 hover:underline">← {labels.backToList}</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">
            <Link href={`/${lang}/audits/${finding.engagement.id}`} className="underline-offset-2 hover:underline">{finding.engagement.title}</Link>
            {finding.requirement ? ` · ${finding.requirement.clauseId}` : ""}
          </p>
          <h1 className="break-words text-2xl font-semibold text-ink">{finding.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{labels.statuses[finding.status as keyof typeof labels.statuses]} · {labels.fields.updated}: {fmt(finding.updatedAt, lang)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${severityClass(finding.severity)}`}>{labels.severities[finding.severity as keyof typeof labels.severities]}</span>
      </header>
      <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-sm text-ink">{finding.description}</p>
      <p className="text-sm text-ink-muted">
        {labels.fields.inherent}: {finding.inherentScore ?? labels.fields.notAssessed} · {labels.fields.residual}: {finding.residualScore ?? labels.fields.notAssessed}
      </p>

      {(canManage || canRemediate) && !(findingsOpen && remediationOpen) && <EngagementLockNotice status={engagementStatus} messages={lockMessages} />}
      {canManage && findingsOpen && !isFindingEditable(finding.status) && <p className="rounded-md border border-line bg-surface p-3 text-sm text-ink-muted">{labels.lockedNotice}</p>}
      {canManage && editable && <EditFinding lang={lang} labels={labels} finding={finding} />}
      {canManage && findingsOpen && <StatusForm lang={lang} labels={labels} finding={finding} isCreator={isCreator} />}

      <section className="space-y-3 rounded-lg border border-line bg-surface p-5" aria-labelledby="finding-actions">
        <h2 id="finding-actions" className="text-lg font-semibold text-ink">{labels.actionsTitle}</h2>
        {finding.actions.length === 0 ? <p className="text-sm text-ink-muted">{labels.noActions}</p> : (
          <ul className="space-y-3">
            {finding.actions.map((a) => (
              <li key={a.id} className="rounded-md border border-line p-3 text-sm text-ink">
                <p className="whitespace-pre-wrap break-words">{a.actionPlan}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {a.ownerName} · {labels.dueDate}: {fmt(a.dueDate, lang)} · {labels.actionStatuses[a.status as keyof typeof labels.actionStatuses]}
                  {a.overdue && <span className="ml-1 font-semibold text-rose-800">· {labels.overdue}</span>}
                  {a.completionEvidenceId && ` · ${labels.completionEvidence}: ${finding.evidence.find((e) => e.id === a.completionEvidenceId)?.originalName ?? "—"}`}
                </p>
                <ActionControls lang={lang} labels={labels} findingId={finding.id} findingStatus={finding.status} action={a} evidence={finding.evidence} canManage={canManage && remediationOpen} canRemediate={canRemediate && remediationOpen} />
              </li>
            ))}
          </ul>
        )}
        {canManage && remediationOpen && canAddRemediationAction(finding.status) && <AddAction lang={lang} labels={labels} findingId={finding.id} />}
      </section>

      <section className="space-y-2 rounded-lg border border-line bg-surface p-5" aria-labelledby="finding-history">
        <h2 id="finding-history" className="text-lg font-semibold text-ink">{labels.historyTitle}</h2>
        {finding.history.length === 0 ? <p className="text-sm text-ink-muted">{labels.noHistory}</p> : (
          <ol className="space-y-1 text-sm text-ink">
            {finding.history.map((h) => <li key={h.id}>{fmt(h.createdAt, lang)}{h.changeNote ? ` — ${h.changeNote}` : ""}</li>)}
          </ol>
        )}
      </section>
    </div>
  );
}

function EditFinding({ lang, labels, finding }: { lang: string; labels: Labels; finding: Finding }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(updateFindingAction, null);
  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-4 text-lg font-semibold text-ink">{labels.editTitle}</summary>
      <form action={action} className="grid gap-4 border-t border-line p-5 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="findingId" value={finding.id} />
        <input type="hidden" name="expectedUpdatedAt" value={finding.updatedAtMs} />
        <FindingFields labels={labels} requirements={finding.requirements} defaults={finding} />
        <div className="md:col-span-2">
          <Feedback state={state} labels={labels} />
          <SubmitButton disabled={pending} className={`mt-3 ${primary}`}>{pending ? labels.saving : labels.save}</SubmitButton>
        </div>
      </form>
    </details>
  );
}

function StatusForm({ lang, labels, finding, isCreator }: { lang: string; labels: Labels; finding: Finding; isCreator: boolean }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(transitionFindingAction, null);
  const targets = FINDING_STATUSES.filter((s) => canTransitionFinding(finding.status, s));
  if (targets.length === 0) return null;
  return (
    <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="finding-status">
      <h2 id="finding-status" className="text-lg font-semibold text-ink">{labels.statusTitle}</h2>
      {isCreator && finding.status === "READY_FOR_REVIEW" && <p className="mt-2 text-sm text-ink-muted">{labels.independentNotice}</p>}
      <form action={action} className="mt-3 grid gap-3 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="findingId" value={finding.id} />
        <input type="hidden" name="expectedUpdatedAt" value={finding.updatedAtMs} />
        <label className="text-sm font-medium text-ink">{labels.targetStatus}
          <select name="targetStatus" required className={input}>{targets.map((s) => <option key={s} value={s}>{labels.statuses[s]}</option>)}</select>
        </label>
        <label className="text-sm font-medium text-ink">{labels.note}
          <input name="note" maxLength={1000} className={input} />
        </label>
        <div className="md:col-span-2">
          <Feedback state={state} labels={labels} />
          <SubmitButton disabled={pending} className={`mt-2 ${primary}`}>{pending ? labels.changingStatus : labels.changeStatus}</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function ActionControls({ lang, labels, findingId, findingStatus, action, evidence, canManage, canRemediate }: {
  lang: string; labels: Labels; findingId: string; findingStatus: string; action: Finding["actions"][number];
  evidence: Finding["evidence"]; canManage: boolean; canRemediate: boolean;
}) {
  const [state, formAction, pending] = useActionState<FindingActionState, FormData>(updateRemediationStatusAction, null);
  let target: string | null = null;
  if (action.status === "OPEN" && canRemediate && findingStatus === "IN_REMEDIATION") target = "IN_PROGRESS";
  else if (action.status === "IN_PROGRESS" && canRemediate && findingStatus === "IN_REMEDIATION") target = "COMPLETED";
  else if (action.status === "COMPLETED" && canManage && findingStatus === "READY_FOR_REVIEW") target = "VERIFIED";
  if (!target) return null;
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="findingId" value={findingId} />
      <input type="hidden" name="actionId" value={action.id} />
      <input type="hidden" name="targetStatus" value={target} />
      {target === "COMPLETED" && (
        <label className="min-w-0 text-xs font-medium text-ink">{labels.completionEvidence}
          <select name="completionEvidenceId" className={input}>
            <option value="">{labels.noEvidence}</option>
            {evidence.map((e) => <option key={e.id} value={e.id}>{e.originalName}</option>)}
          </select>
        </label>
      )}
      <SubmitButton disabled={pending} className={secondary}>{labels.markStatus} {labels.actionStatuses[target as keyof typeof labels.actionStatuses]}</SubmitButton>
      {target === "VERIFIED" && <span className="text-xs text-ink-muted">{labels.verifiedHint}</span>}
      <div className="w-full"><Feedback state={state} labels={labels} /></div>
    </form>
  );
}

function AddAction({ lang, labels, findingId }: { lang: string; labels: Labels; findingId: string }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(addRemediationActionAction, null);
  return (
    <form action={action} className="grid gap-3 border-t border-line pt-4 md:grid-cols-3">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="findingId" value={findingId} />
      <label className="text-sm font-medium text-ink md:col-span-3">{labels.actionPlan}<textarea name="actionPlan" required minLength={10} maxLength={2000} rows={2} className={input} /></label>
      <label className="text-sm font-medium text-ink md:col-span-2">{labels.owner}<input name="ownerName" required minLength={2} maxLength={120} className={input} /></label>
      <label className="text-sm font-medium text-ink">{labels.dueDate}<input name="dueDate" type="date" required className={input} /></label>
      <div className="md:col-span-3">
        <Feedback state={state} labels={labels} />
        <SubmitButton disabled={pending} className={`mt-2 ${primary}`}>{pending ? labels.addingAction : labels.addAction}</SubmitButton>
      </div>
    </form>
  );
}
