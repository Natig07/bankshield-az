"use client";

import { useActionState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { VerificationStatus } from "@/lib/domain/enums";
import {
  addVersionAction,
  createRequirementAction,
  createSourceAction,
  transitionRequirementAction,
  transitionVersionAction,
  updateRequirementAction,
  updateSourceAction,
  updateVersionAction,
  type RegulatoryActionState,
} from "./actions";
import { canTransitionVerificationStatus } from "@/lib/regulatory/workflow";
import { SubmitButton } from "@/components/submit-button";

type Labels = Dictionary["regulatoryLibrary"];

type Requirement = {
  id: string;
  clauseId: string;
  section: string | null;
  topic: string | null;
  textOriginal: string | null;
  textTranslation: string | null;
  translationLabel: string | null;
  translationSource: string | null;
  applicability: string | null;
  requirementType: string;
  verificationStatus: string;
  history: { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
};

type Version = {
  id: string;
  versionLabel: string;
  sourceUrl: string;
  decisionNumber: string | null;
  decisionDate: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  verificationStatus: string;
  verificationNotes: string | null;
  requirements: Requirement[];
  history: { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
};

export type RegulatoryDocumentRow = {
  id: string;
  code: string;
  title: string;
  issuer: string;
  sourceUrl: string;
  kind: string;
  language: string;
  versions: Version[];
};

export function RegulatoryLibrary({
  documents,
  labels,
  verification,
  lang,
  canManage,
}: {
  documents: RegulatoryDocumentRow[];
  labels: Labels;
  verification: Record<VerificationStatus, string>;
  lang: string;
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      <div role="note" className="rounded-lg border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
        <p>{labels.pendingNotice}</p>
        <p className="mt-2">{labels.lockedNotice}</p>
        <p className="mt-2">{labels.noDeleteNotice}</p>
      </div>
      {canManage && <CreateSourceForm labels={labels} lang={lang} />}
      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">
          {labels.noSources}
        </p>
      ) : (
        documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            labels={labels}
            verification={verification}
            lang={lang}
            canManage={canManage}
          />
        ))
      )}
    </div>
  );
}

function DocumentCard({
  document,
  labels,
  verification,
  lang,
  canManage,
}: {
  document: RegulatoryDocumentRow;
  labels: Labels;
  verification: Record<VerificationStatus, string>;
  lang: string;
  canManage: boolean;
}) {
  return (
    <article className="rounded-lg border border-line bg-surface">
      <header className="border-b border-line p-5">
        <p className="text-xs font-medium text-ink-muted">{document.code}</p>
        <h2 className="mt-1 text-lg font-semibold text-ink">{document.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{document.issuer}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {labels.sourceKinds[document.kind as keyof typeof labels.sourceKinds] ?? document.kind}
          {" · "}
          {labels.languages[document.language as keyof typeof labels.languages] ?? document.language}
        </p>
        {safeHttpUrl(document.sourceUrl) && (
          <a href={safeHttpUrl(document.sourceUrl)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-teal-strong underline">
            {document.sourceUrl}
          </a>
        )}
      </header>
      <div className="space-y-5 p-5">
        {canManage && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-teal-strong">{labels.editSource}</summary>
            <SourceEditForm document={document} labels={labels} lang={lang} />
          </details>
        )}
        <div>
          <h3 className="text-sm font-semibold text-ink">{labels.versions}</h3>
          {document.versions.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{labels.noVersions}</p>
          ) : (
            <div className="mt-3 space-y-4">
              {document.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  version={version}
                  labels={labels}
                  verification={verification}
                  lang={lang}
                  canManage={canManage}
                />
              ))}
            </div>
          )}
        </div>
        {canManage && <AddVersionForm documentId={document.id} sourceUrl={document.sourceUrl} labels={labels} lang={lang} />}
      </div>
    </article>
  );
}

function VersionCard({
  version,
  labels,
  verification,
  lang,
  canManage,
}: {
  version: Version;
  labels: Labels;
  verification: Record<VerificationStatus, string>;
  lang: string;
  canManage: boolean;
}) {
  const status = asVerificationStatus(version.verificationStatus);
  return (
    <section className="rounded-md border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-medium text-ink">{version.versionLabel}</h4>
          <p className="mt-1 text-sm text-ink-muted">{status ? verification[status] : version.verificationStatus}</p>
          {version.decisionNumber && <p className="mt-1 text-xs text-ink-muted">{labels.fields.decisionNumber}: {version.decisionNumber}</p>}
          <p className="mt-1 text-xs text-ink-muted">
            {labels.fields.decisionDate}: {formatDate(version.decisionDate, labels.emptyDate)}
            {" · "}{labels.fields.effectiveFrom}: {formatDate(version.effectiveFrom, labels.emptyDate)}
            {" · "}{labels.fields.effectiveTo}: {formatDate(version.effectiveTo, labels.emptyDate)}
          </p>
          {safeHttpUrl(version.sourceUrl) && (
            <a href={safeHttpUrl(version.sourceUrl)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-teal-strong underline">
              {version.sourceUrl}
            </a>
          )}
          {version.verificationNotes && <p className="mt-2 text-sm text-ink-muted">{version.verificationNotes}</p>}
        </div>
        {canManage && status && (
          <TransitionForm
            id={version.id}
            fieldName="versionId"
            status={status}
            action={transitionVersionAction}
            labels={labels}
            lang={lang}
          />
        )}
      </div>
      {canManage && status === "PENDING_VERIFICATION" && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-teal-strong">{labels.editVersion}</summary>
          <VersionEditForm version={version} labels={labels} lang={lang} />
        </details>
      )}
      <History history={version.history} labels={labels} />
      <div className="mt-4 border-t border-line pt-4">
        <h5 className="text-sm font-semibold text-ink">{labels.requirements} ({version.requirements.length})</h5>
        {version.requirements.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{labels.noRequirements}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {version.requirements.map((requirement) => (
              <RequirementCard
                key={requirement.id}
                requirement={requirement}
                labels={labels}
                verification={verification}
                lang={lang}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
        {canManage && <CreateRequirementForm versionId={version.id} labels={labels} lang={lang} />}
      </div>
    </section>
  );
}

function RequirementCard({
  requirement,
  labels,
  verification,
  lang,
  canManage,
}: {
  requirement: Requirement;
  labels: Labels;
  verification: Record<VerificationStatus, string>;
  lang: string;
  canManage: boolean;
}) {
  const status = asVerificationStatus(requirement.verificationStatus);
  return (
    <li className="rounded border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h6 className="font-medium text-ink">{requirement.clauseId}</h6>
          <p className="mt-1 text-xs text-ink-muted">{status ? verification[status] : requirement.verificationStatus}</p>
          {requirement.topic && <p className="mt-2 text-sm text-ink">{requirement.topic}</p>}
          {requirement.section && <p className="mt-1 text-xs text-ink-muted">{labels.fields.section}: {requirement.section}</p>}
          <p className="mt-1 text-xs text-ink-muted">
            {labels.fields.requirementType}: {labels.requirementTypes[requirement.requirementType as keyof typeof labels.requirementTypes] ?? requirement.requirementType}
          </p>
          {requirement.textOriginal && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{requirement.textOriginal}</p>}
          {requirement.textTranslation && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
              {requirement.translationLabel ? `${requirement.translationLabel}: ` : ""}{requirement.textTranslation}
            </p>
          )}
          {requirement.applicability && (
            <p className="mt-2 text-xs text-ink-muted">{labels.fields.applicability}: {requirement.applicability}</p>
          )}
        </div>
        {canManage && status && (
          <TransitionForm
            id={requirement.id}
            fieldName="requirementId"
            status={status}
            action={transitionRequirementAction}
            labels={labels}
            lang={lang}
          />
        )}
      </div>
      {canManage && status === "PENDING_VERIFICATION" && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-teal-strong">{labels.editRequirement}</summary>
          <RequirementForm
            action={updateRequirementAction}
            labels={labels}
            lang={lang}
            requirement={requirement}
          />
        </details>
      )}
      <History history={requirement.history} labels={labels} />
    </li>
  );
}

function CreateSourceForm({ labels, lang }: { labels: Labels; lang: string }) {
  const [state, action, pending] = useActionState(createSourceAction, null);
  return (
    <details className="rounded-lg border border-line bg-surface p-5" open={false}>
      <summary className="cursor-pointer text-lg font-semibold text-ink">{labels.createSource}</summary>
      <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <Field label={labels.fields.code} name="code" required maxLength={80} />
        <Field label={labels.fields.title} name="title" required maxLength={300} />
        <Field label={labels.fields.issuer} name="issuer" required maxLength={200} />
        <Field label={labels.fields.sourceUrl} name="sourceUrl" type="url" required maxLength={2048} />
        <SelectField label={labels.fields.kind} name="kind" options={labels.sourceKinds} />
        <SelectField label={labels.fields.language} name="language" options={labels.languages} />
        <Field label={labels.fields.versionLabel} name="versionLabel" required maxLength={120} />
        <Field label={labels.fields.decisionNumber} name="decisionNumber" maxLength={120} />
        <Field label={labels.fields.decisionDate} name="decisionDate" type="date" />
        <Field label={labels.fields.effectiveFrom} name="effectiveFrom" type="date" />
        <Field label={labels.fields.effectiveTo} name="effectiveTo" type="date" />
        <Submit state={state} pending={pending} labels={labels} />
      </form>
    </details>
  );
}

function SourceEditForm({
  document,
  labels,
  lang,
}: {
  document: RegulatoryDocumentRow;
  labels: Labels;
  lang: string;
}) {
  const [state, action, pending] = useActionState(updateSourceAction, null);
  return (
    <form action={action} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="documentId" value={document.id} />
      <Field label={labels.fields.title} name="title" value={document.title} required maxLength={300} />
      <Field label={labels.fields.issuer} name="issuer" value={document.issuer} required maxLength={200} />
      <Field label={labels.fields.sourceUrl} name="sourceUrl" type="url" value={document.sourceUrl} required maxLength={2048} />
      <SelectField label={labels.fields.kind} name="kind" options={labels.sourceKinds} value={document.kind} />
      <SelectField label={labels.fields.language} name="language" options={labels.languages} value={document.language} />
      <Submit state={state} pending={pending} labels={labels} />
    </form>
  );
}

function AddVersionForm({
  documentId,
  sourceUrl,
  labels,
  lang,
}: {
  documentId: string;
  sourceUrl: string;
  labels: Labels;
  lang: string;
}) {
  const [state, action, pending] = useActionState(addVersionAction, null);
  return (
    <details className="border-t border-line pt-4">
      <summary className="cursor-pointer text-sm font-medium text-teal-strong">{labels.addVersion}</summary>
      <form action={action} className="mt-3 grid gap-3 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="documentId" value={documentId} />
        <Field label={labels.fields.versionLabel} name="versionLabel" required maxLength={120} />
        <Field label={labels.fields.sourceUrl} name="sourceUrl" type="url" value={sourceUrl} required maxLength={2048} />
        <Field label={labels.fields.decisionNumber} name="decisionNumber" maxLength={120} />
        <Field label={labels.fields.decisionDate} name="decisionDate" type="date" />
        <Field label={labels.fields.effectiveFrom} name="effectiveFrom" type="date" />
        <Field label={labels.fields.effectiveTo} name="effectiveTo" type="date" />
        <Submit state={state} pending={pending} labels={labels} />
      </form>
    </details>
  );
}

function VersionEditForm({ version, labels, lang }: { version: Version; labels: Labels; lang: string }) {
  const [state, action, pending] = useActionState(updateVersionAction, null);
  return (
    <form action={action} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="versionId" value={version.id} />
      <Field label={labels.fields.sourceUrl} name="sourceUrl" type="url" value={version.sourceUrl} required maxLength={2048} />
      <Field label={labels.fields.decisionNumber} name="decisionNumber" value={version.decisionNumber ?? ""} maxLength={120} />
      <Field label={labels.fields.decisionDate} name="decisionDate" type="date" value={formatDate(version.decisionDate, "")} />
      <Field label={labels.fields.effectiveFrom} name="effectiveFrom" type="date" value={formatDate(version.effectiveFrom, "")} />
      <Field label={labels.fields.effectiveTo} name="effectiveTo" type="date" value={formatDate(version.effectiveTo, "")} />
      <Submit state={state} pending={pending} labels={labels} />
    </form>
  );
}

function CreateRequirementForm({ versionId, labels, lang }: { versionId: string; labels: Labels; lang: string }) {
  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-sm font-medium text-teal-strong">{labels.createRequirement}</summary>
      <RequirementForm
        action={createRequirementAction}
        labels={labels}
        lang={lang}
        versionId={versionId}
      />
    </details>
  );
}

function RequirementForm({
  action: serverAction,
  labels,
  lang,
  versionId,
  requirement,
}: {
  action: (state: RegulatoryActionState, formData: FormData) => Promise<RegulatoryActionState>;
  labels: Labels;
  lang: string;
  versionId?: string;
  requirement?: Requirement;
}) {
  const [state, action, pending] = useActionState(serverAction, null);
  return (
    <form action={action} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="lang" value={lang} />
      {versionId && <input type="hidden" name="versionId" value={versionId} />}
      {requirement && <input type="hidden" name="requirementId" value={requirement.id} />}
      <Field label={labels.fields.clauseId} name="clauseId" value={requirement?.clauseId} required maxLength={120} />
      <Field label={labels.fields.section} name="section" value={requirement?.section ?? ""} maxLength={200} />
      <Field label={labels.fields.topic} name="topic" value={requirement?.topic ?? ""} maxLength={300} />
      <SelectField
        label={labels.fields.requirementType}
        name="requirementType"
        options={labels.requirementTypes}
        value={requirement?.requirementType ?? "MANDATORY_LAW"}
      />
      <Area label={labels.fields.textOriginal} name="textOriginal" value={requirement?.textOriginal ?? ""} />
      <Area label={labels.fields.textTranslation} name="textTranslation" value={requirement?.textTranslation ?? ""} />
      <Field label={labels.fields.translationLabel} name="translationLabel" value={requirement?.translationLabel ?? ""} maxLength={200} />
      <Field label={labels.fields.translationSource} name="translationSource" value={requirement?.translationSource ?? ""} maxLength={500} />
      <Area label={labels.fields.applicability} name="applicability" value={requirement?.applicability ?? ""} />
      <Submit state={state} pending={pending} labels={labels} />
    </form>
  );
}

function TransitionForm({
  id,
  fieldName,
  status,
  action: serverAction,
  labels,
  lang,
}: {
  id: string;
  fieldName: "versionId" | "requirementId";
  status: VerificationStatus;
  action: (state: RegulatoryActionState, formData: FormData) => Promise<RegulatoryActionState>;
  labels: Labels;
  lang: string;
}) {
  const [state, action, pending] = useActionState(serverAction, null);
  const targets = (Object.keys(labels.actions) as VerificationStatus[])
    .filter((target) => canTransitionVerificationStatus(status, target));
  return (
    <form action={action} className="w-full max-w-sm space-y-2 rounded border border-line bg-surface p-3">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name={fieldName} value={id} />
      {targets.length === 0 ? (
        <p className="text-xs text-ink-muted">{labels.actions.noTransition}</p>
      ) : (
        <>
          <label className="block text-xs font-medium text-ink">
            {labels.transition}
            <select name="targetStatus" className="mt-1 block w-full rounded border border-line bg-surface px-2 py-1.5 text-ink">
              {targets.map((target) => <option key={target} value={target}>{labels.actions[target]}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-ink">
            {labels.reviewNote}
            <textarea name="note" required maxLength={2000} rows={2} className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-ink" />
          </label>
          <SubmitButton disabled={pending} className="rounded bg-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
            {pending ? labels.saving : labels.save}
          </SubmitButton>
        </>
      )}
      <Feedback state={state} labels={labels} />
    </form>
  );
}

function History({
  history,
  labels,
}: {
  history: Version["history"];
  labels: Labels;
}) {
  if (history.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-ink-muted">{labels.historyTitle}</summary>
      <ul className="mt-2 space-y-2 text-xs text-ink-muted">
        {history.map((event, index) => (
          <li key={`${event.createdAt}-${index}`}>
            {event.fromStatus ? labels.actions[event.fromStatus as keyof typeof labels.actions] ?? event.fromStatus : "—"}
            {" → "}
            {labels.actions[event.toStatus as keyof typeof labels.actions] ?? event.toStatus}
            {" · "}{event.createdAt.slice(0, 10)}
            {event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Field({
  label,
  name,
  value,
  type = "text",
  required = false,
  maxLength,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        maxLength={maxLength}
        className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
      />
    </label>
  );
}

function Area({ label, name, value }: { label: string; name: string; value?: string }) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <textarea name={name} defaultValue={value} rows={3} maxLength={20_000} className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: Record<string, string>;
  value?: string;
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <select name={name} defaultValue={value ?? Object.keys(options)[0]} className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
        {Object.entries(options).map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
    </label>
  );
}

function Submit({
  state,
  pending,
  labels,
}: {
  state: RegulatoryActionState;
  pending: boolean;
  labels: Labels;
}) {
  return (
    <div className="md:col-span-2">
      <Feedback state={state} labels={labels} />
      <SubmitButton disabled={pending} className="mt-2 rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? labels.saving : labels.save}
      </SubmitButton>
    </div>
  );
}

function Feedback({ state, labels }: { state: RegulatoryActionState; labels: Labels }) {
  if (!state?.error && !state?.success) return null;
  const message = state.error ? labels.actions[state.error] : state.success ? labels.actions[state.success] : "";
  return (
    <p role={state.error ? "alert" : "status"} className={`text-sm ${state.error ? "text-rose-800" : "text-emerald-800"}`}>
      {message}
    </p>
  );
}

function asVerificationStatus(status: string): VerificationStatus | null {
  return status === "PENDING_VERIFICATION" ||
    status === "UNDER_LEGAL_REVIEW" ||
    status === "VERIFIED" ||
    status === "SUPERSEDED"
    ? status
    : null;
}

function formatDate(value: string | null, empty: string): string {
  return value ? value.slice(0, 10) : empty;
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
