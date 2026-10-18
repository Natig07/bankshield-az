"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { VerificationStatus } from "@/lib/domain/enums";
import { canTransitionEngagementStatus, ENGAGEMENT_STATUSES } from "@/lib/audits/workflow";
import { AssessmentWorkflow } from "./assessment-workflow";
import {
  addParticipantAction,
  assignAuditorAction,
  removeParticipantAction,
  selectRequirementAction,
  transitionEngagementAction,
  updateEngagementAction,
  type EngagementActionState,
} from "../actions";
import { Feedback, formatDate } from "../engagement-list";
import { EngagementLockNotice } from "@/components/engagement-lock-notice";
import { engagementAllows } from "@/lib/audits/workflow";

type Labels = Dictionary["auditWorkflow"];
type Detail = {
  id: string;
  title: string;
  auditedOrganization: string;
  scope: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  createdBy: { name: string; email: string };
  members: {
    id: string;
    createdAt: Date;
    user: { id: string; name: string; email: string; isActive: boolean; role: string };
  }[];
  requirementSelections: {
    id: string;
    selectedAt: Date;
    verificationStatusAtSelection: string;
    unverifiedAcknowledged: boolean;
    decisionNote: string | null;
    selectedBy: { name: string };
    requirement: {
      id: string;
      clauseId: string;
      topic: string | null;
      verificationStatus: string;
      version: {
        versionLabel: string;
        document: { code: string; title: string; issuer: string; sourceUrl: string };
      };
      scopeItems: { assessments: { status: string }[] }[];
    };
  }[];
  scopeItems: { assessments: { status: string }[] }[];
  findings: { id: string; severity: string; status: string }[];
  _count: { evidence: number };
  auditEvents: {
    id: string;
    action: string;
    detail: string | null;
    createdAt: Date;
    actor: { name: string } | null;
  }[];
};

type RequirementOption = {
  id: string;
  clauseId: string;
  topic: string | null;
  verificationStatus: string;
  version: {
    versionLabel: string;
    document: { code: string; title: string; issuer: string };
  };
};

type Auditor = { id: string; name: string; email: string };
type AssessmentData = {
  id: string;
  evidence: {
    id: string;
    controlId: string | null;
    originalName: string;
    reviewStatus: string;
    uploadedAt: string;
  }[];
  scopeItems: React.ComponentProps<typeof AssessmentWorkflow>["scopeItems"];
};

export function EngagementDetails({
  lang,
  labels,
  verification,
  engagement,
  requirements,
  auditors,
  canManage,
  canAssignAuditors,
  analysts,
  assessmentData,
  assessmentLabels,
  assessmentStatuses,
  canAssess,
  currentUserId,
  lockMessages,
}: {
  lang: string;
  labels: Labels;
  verification: Record<VerificationStatus, string>;
  engagement: Detail;
  requirements: RequirementOption[];
  auditors: Auditor[];
  canManage: boolean;
  canAssignAuditors: boolean;
  analysts: Auditor[];
  assessmentData: AssessmentData;
  assessmentLabels: Dictionary["assessmentWorkflow"];
  assessmentStatuses: Dictionary["dashboard"]["assessmentStatuses"];
  canAssess: boolean;
  currentUserId: string;
  lockMessages: Record<string, string>;
}) {
  const currentStatus = engagement.status;
  // Mirrors the server-side operation gates; the server remains the authority.
  const editable = engagementAllows(currentStatus, "editEngagement");
  const canReviseNow = canAssess && engagementAllows(currentStatus, "assessControl");
  const canApproveNow = canAssess && engagementAllows(currentStatus, "approveAssessment");
  const showLockNotice = !editable && (canManage || canAssignAuditors || canAssess);
  const assessed = engagement.scopeItems.filter((item) =>
    item.assessments.some((assessment) => assessment.status !== "NOT_TESTED"),
  ).length;
  const openFindings = engagement.findings.filter((finding) => finding.status !== "CLOSED").length;
  const availableAuditors = auditors.filter(({ id }) => !engagement.members.some((member) => member.user.id === id));
  const participants = engagement.members.filter(({ user }) => user.role === "SECURITY_ANALYST");
  const availableAnalysts = analysts.filter(({ id }) => !engagement.members.some((member) => member.user.id === id));

  return (
    <div className="space-y-6">
      <Link href={`/${lang}/audits`} className="text-sm text-teal-strong underline underline-offset-2">{labels.backToList}</Link>
      <header className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">{engagement.title}</h1>
            <p className="mt-1 text-sm text-ink-muted">{engagement.auditedOrganization || "—"}</p>
          </div>
          <span className="rounded-full bg-canvas px-3 py-1 text-sm font-medium text-ink">
            {labels.statusLabels[currentStatus as keyof typeof labels.statusLabels] ?? currentStatus}
          </span>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Info label={labels.period}>{formatDate(engagement.periodStart, lang)} – {formatDate(engagement.periodEnd, lang)}</Info>
          <Info label={labels.createdBy}>{engagement.createdBy.name}</Info>
          <Info label={labels.assignedAuditor}>
            {engagement.members.filter(({ user }) => user.role === "AUDITOR").map(({ user }) => user.name).join(", ") || "—"}
          </Info>
          <Info label={labels.updated}>{formatDate(engagement.updatedAt, lang)}</Info>
          <Info label={labels.scope}>{engagement.scope}</Info>
        </dl>
        {showLockNotice && (
          <div className="mt-6">
            <EngagementLockNotice status={currentStatus} messages={lockMessages} />
          </div>
        )}
        {canManage && (
          <div className="mt-6 grid gap-5 border-t border-line pt-5 lg:grid-cols-2">
            {editable && <EditEngagementForm engagement={engagement} lang={lang} labels={labels} />}
            <StatusForm engagement={engagement} lang={lang} labels={labels} />
          </div>
        )}
        {(canAssignAuditors || participants.length > 0) && (
          <ParticipantsSection
            lang={lang}
            engagementId={engagement.id}
            labels={labels}
            participants={participants.map(({ user }) => user)}
            available={availableAnalysts}
            canManage={canAssignAuditors && editable}
          />
        )}
        {canAssignAuditors && editable && (
          <AssignAuditorForm
            lang={lang}
            engagementId={engagement.id}
            labels={labels}
            auditors={availableAuditors}
          />
        )}
      </header>

      <section className="grid gap-4 sm:grid-cols-3" aria-label={labels.detailsTitle}>
        <Metric label={labels.assessmentProgress} value={`${assessed} / ${engagement.scopeItems.length}`} detail={labels.assessments} />
        <Metric label={labels.openFindings} value={openFindings} detail={`${labels.findings}: ${engagement.findings.length}`} />
        <Metric label={labels.evidence} value={engagement._count.evidence} href={`/${lang}/evidence?engagement=${engagement.id}`} />
      </section>

      <AssessmentWorkflow
        lang={lang}
        engagementId={engagement.id}
        labels={assessmentLabels}
        statuses={assessmentStatuses}
        verification={verification}
        scopeItems={assessmentData.scopeItems}
        evidence={assessmentData.evidence}
        canAssess={canReviseNow}
        canApprove={canApproveNow}
        currentUserId={currentUserId}
      />

      <section className="space-y-4 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold text-ink">{labels.requirementsTitle}</h2>
        {engagement.requirementSelections.length === 0 ? (
          <p className="text-sm text-ink-muted">{labels.noSelectedRequirements}</p>
        ) : (
          <div className="space-y-3">
            {engagement.requirementSelections.map((selection) => (
              <article key={selection.id} className="rounded-md border border-line bg-canvas p-4">
                <RequirementProvenance
                  requirement={selection.requirement}
                  labels={labels}
                  verification={verification}
                />
                {selection.requirement.verificationStatus !== "VERIFIED" && (
                  <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    {labels.unverifiedNotice}
                  </p>
                )}
                <p className="mt-3 text-xs text-ink-muted">
                  {labels.decisionRecorded}: {selection.selectedBy.name}, {formatDate(selection.selectedAt, lang)}; {labels.verification}: {verificationLabel(selection.verificationStatusAtSelection, verification)}
                </p>
                {selection.unverifiedAcknowledged && selection.decisionNote && (
                  <p className="mt-2 text-sm text-ink">{labels.decisionNote}: {selection.decisionNote}</p>
                )}
              </article>
            ))}
          </div>
        )}
        {canManage && editable && (
          <div className="border-t border-line pt-4">
            <h3 className="mb-3 font-medium text-ink">{labels.availableRequirements}</h3>
            {requirements.length === 0 ? (
              <p className="text-sm text-ink-muted">{labels.noRequirements}</p>
            ) : (
              <div className="space-y-3">
                {requirements.map((requirement) => (
                  <RequirementSelectionForm
                    key={requirement.id}
                    requirement={requirement}
                    engagementId={engagement.id}
                    lang={lang}
                    labels={labels}
                    verification={verification}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold text-ink">{labels.auditTrail}</h2>
        {engagement.auditEvents.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{labels.noAuditTrail}</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {engagement.auditEvents.map((event) => (
              <li key={event.id} className="border-l-2 border-line pl-3 text-sm">
                <p className="font-medium text-ink">{labels.events[event.action as keyof typeof labels.events] ?? event.action}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {event.actor?.name ?? "—"} · {formatDate(event.createdAt, lang)}
                  {event.action === "AUDIT_ENGAGEMENT_STATUS_CHANGED" && event.detail
                    ? ` · ${formatStatusTransition(event.detail, labels)}`
                    : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function EditEngagementForm({ engagement, lang, labels }: { engagement: Detail; lang: string; labels: Labels }) {
  const [state, action, pending] = useActionState<EngagementActionState, FormData>(updateEngagementAction, null);
  return (
    <details>
      <summary className="cursor-pointer font-medium text-teal-strong">{labels.edit}</summary>
      <form action={action} className="mt-3 grid gap-3">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="engagementId" value={engagement.id} />
        <Input label={labels.titleField} name="title" defaultValue={engagement.title} maxLength={200} required />
        <Input label={labels.organization} name="auditedOrganization" defaultValue={engagement.auditedOrganization} maxLength={200} required />
        <Input label={labels.startDate} name="periodStart" type="date" defaultValue={dateInput(engagement.periodStart)} required />
        <Input label={labels.endDate} name="periodEnd" type="date" defaultValue={dateInput(engagement.periodEnd)} required />
        <label className="text-sm font-medium text-ink">
          {labels.scope}
          <textarea name="scope" defaultValue={engagement.scope} required minLength={2} maxLength={5000} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal" />
        </label>
        <Feedback state={state} labels={labels} />
        <button type="submit" disabled={pending} className="justify-self-start rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? labels.saving : labels.save}</button>
      </form>
    </details>
  );
}

function StatusForm({ engagement, lang, labels }: { engagement: Detail; lang: string; labels: Labels }) {
  const [state, action, pending] = useActionState<EngagementActionState, FormData>(transitionEngagementAction, null);
  const transitions = ENGAGEMENT_STATUSES.filter((target) => canTransitionEngagementStatus(engagement.status, target));
  if (transitions.length === 0) return null;
  return (
    <form action={action} className="self-start">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="engagementId" value={engagement.id} />
      <label htmlFor="engagement-target-status" className="mb-1 block text-sm font-medium text-ink">{labels.status}</label>
      <div className="flex flex-wrap gap-2">
        <select id="engagement-target-status" name="targetStatus" className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
          {transitions.map((status) => <option key={status} value={status}>{labels.statusLabels[status]}</option>)}
        </select>
        <button type="submit" disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-60">{pending ? labels.updatingStatus : labels.saveStatus}</button>
      </div>
      <div className="mt-2"><Feedback state={state} labels={labels} /></div>
    </form>
  );
}

function AssignAuditorForm({
  lang,
  engagementId,
  labels,
  auditors,
}: {
  lang: string;
  engagementId: string;
  labels: Labels;
  auditors: Auditor[];
}) {
  const [state, action, pending] = useActionState<EngagementActionState, FormData>(assignAuditorAction, null);
  return (
    <form action={action} className="mt-5 border-t border-line pt-4">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="engagementId" value={engagementId} />
      <label htmlFor="add-auditor" className="mb-1 block text-sm font-medium text-ink">{labels.assignedAuditor}</label>
      <div className="flex flex-wrap gap-2">
        <select id="add-auditor" name="auditorId" required disabled={auditors.length === 0} className="min-w-64 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
          <option value="">—</option>
          {auditors.map((auditor) => <option key={auditor.id} value={auditor.id}>{auditor.name} ({auditor.email})</option>)}
        </select>
        <button type="submit" disabled={pending || auditors.length === 0} className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? labels.assigningAuditor : labels.addAuditor}</button>
      </div>
      <div className="mt-2"><Feedback state={state} labels={labels} /></div>
    </form>
  );
}

function RequirementSelectionForm({
  requirement,
  engagementId,
  lang,
  labels,
  verification,
}: {
  requirement: RequirementOption;
  engagementId: string;
  lang: string;
  labels: Labels;
  verification: Record<VerificationStatus, string>;
}) {
  const [state, action, pending] = useActionState<EngagementActionState, FormData>(selectRequirementAction, null);
  const verified = requirement.verificationStatus === "VERIFIED";
  return (
    <form action={action} className="rounded-md border border-line p-4">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="engagementId" value={engagementId} />
      <input type="hidden" name="requirementId" value={requirement.id} />
      <RequirementProvenance requirement={requirement} labels={labels} verification={verification} />
      {!verified && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{labels.unverifiedNotice}</p>
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" name="acknowledgeUnverified" value="true" required className="mt-1" />
            <span>{labels.acknowledgeUnverified}</span>
          </label>
          <label className="mt-3 block text-sm font-medium">
            {labels.decisionNote}
            <textarea name="decisionNote" required maxLength={1000} rows={2} className="mt-1 w-full rounded-md border border-amber-400 bg-white px-3 py-2 text-ink" />
          </label>
        </div>
      )}
      {verified && <input type="hidden" name="acknowledgeUnverified" value="false" />}
      <Feedback state={state} labels={labels} />
      <button type="submit" disabled={pending} className="mt-3 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-60">{pending ? labels.selectingRequirement : labels.selectRequirement}</button>
    </form>
  );
}

function RequirementProvenance({
  requirement,
  labels,
  verification,
}: {
  requirement: RequirementOption;
  labels: Labels;
  verification: Record<VerificationStatus, string>;
}) {
  const source = requirement.version.document;
  const status = verificationLabel(requirement.verificationStatus, verification);
  return (
    <div>
      <h3 className="font-medium text-ink">{source.code} · {requirement.clauseId}{requirement.topic ? ` · ${requirement.topic}` : ""}</h3>
      <p className="mt-1 text-sm text-ink">{source.title} ({source.issuer})</p>
      <dl className="mt-2 grid gap-1 text-xs text-ink-muted sm:grid-cols-2">
        <div><dt className="inline font-medium">{labels.source}: </dt><dd className="inline">{source.code}, {requirement.version.versionLabel}</dd></div>
        <div><dt className="inline font-medium">{labels.clause}: </dt><dd className="inline">{requirement.clauseId}</dd></div>
        <div><dt className="inline font-medium">{labels.topic}: </dt><dd className="inline">{requirement.topic || "—"}</dd></div>
        <div><dt className="inline font-medium">{labels.verification}: </dt><dd className="inline">{status}</dd></div>
      </dl>
    </div>
  );
}

function verificationLabel(status: string, labels: Record<VerificationStatus, string>) {
  return status in labels ? labels[status as VerificationStatus] : status;
}

function formatStatusTransition(detail: string, labels: Labels) {
  const match = /^([A-Z_]+) -> ([A-Z_]+)$/.exec(detail);
  if (!match) return "";
  const from = labels.statusLabels[match[1] as keyof typeof labels.statusLabels] ?? match[1];
  const to = labels.statusLabels[match[2] as keyof typeof labels.statusLabels] ?? match[2];
  return `${from} → ${to}`;
}

function Input({
  label,
  name,
  defaultValue,
  type = "text",
  maxLength,
  required = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium text-ink">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} maxLength={maxLength} required={required} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2" />
    </label>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sm:col-span-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-ink">{children}</dd>
    </div>
  );
}

function Metric({ label, value, detail, href }: { label: string; value: string | number; detail?: string; href?: string }) {
  return (
    <article className="rounded-lg border border-line bg-surface p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-ink">{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-muted">{detail}</p>}
      {href && <Link href={href} className="mt-2 inline-block text-xs text-teal-strong underline underline-offset-2">{label}</Link>}
    </article>
  );
}

function ParticipantsSection({
  lang,
  engagementId,
  labels,
  participants,
  available,
  canManage,
}: {
  lang: string;
  engagementId: string;
  labels: Labels;
  participants: Auditor[];
  available: Auditor[];
  canManage: boolean;
}) {
  const [addState, addAction, adding] = useActionState<EngagementActionState, FormData>(addParticipantAction, null);
  const [removeState, removeAction, removing] = useActionState<EngagementActionState, FormData>(removeParticipantAction, null);
  return (
    <section className="mt-5 border-t border-line pt-4" aria-labelledby="participants-title">
      <h2 id="participants-title" className="text-sm font-medium text-ink">{labels.participants}</h2>
      <p className="mt-1 text-xs text-ink-muted">{labels.participantsHint}</p>
      {participants.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{labels.noParticipants}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {participants.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center gap-3 text-sm text-ink">
              <span>{person.name} ({person.email})</span>
              {canManage && (
                <form action={removeAction}>
                  <input type="hidden" name="lang" value={lang} />
                  <input type="hidden" name="engagementId" value={engagementId} />
                  <input type="hidden" name="userId" value={person.id} />
                  <button type="submit" disabled={removing} className="rounded-md border border-line px-2 py-1 text-xs text-ink disabled:opacity-60">{labels.removeParticipant}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form action={addAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="engagementId" value={engagementId} />
          <label htmlFor="add-participant" className="sr-only">{labels.addParticipant}</label>
          <select id="add-participant" name="userId" required disabled={available.length === 0} className="min-w-64 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
            <option value="">{labels.chooseParticipant}</option>
            {available.map((person) => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}
          </select>
          <button type="submit" disabled={adding || available.length === 0} className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{adding ? labels.addingParticipant : labels.addParticipant}</button>
          {available.length === 0 && <p className="w-full text-xs text-ink-muted">{labels.noAnalysts}</p>}
        </form>
      )}
      <div className="mt-2" role="status"><Feedback state={removeState ?? addState} labels={labels} /></div>
    </section>
  );
}

function dateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}
