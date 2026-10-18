"use client";

import { useActionState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { VerificationStatus } from "@/lib/domain/enums";
import {
  createControlAction,
  createMappingAction,
  updateControlAction,
  type ControlActionState,
} from "./actions";

type Labels = Dictionary["controlWorkflow"];
type Requirement = {
  id: string;
  clauseId: string;
  topic: string | null;
  verificationStatus: string;
  version: {
    versionLabel: string;
    document: { code: string; title: string; issuer: string };
  };
};
type Mapping = {
  id: string;
  rationale: string | null;
  createdAt: string;
  requirement: Requirement & {
    version: {
      versionLabel: string;
      document: { code: string; title: string; issuer: string; sourceUrl: string };
    };
  };
};
type Control = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  domain: string | null;
  source: string;
  mappings: Mapping[];
};

export function ControlCatalogue({
  lang,
  labels,
  verification,
  controls,
  requirements,
  search,
  canManage,
}: {
  lang: string;
  labels: Labels;
  verification: Record<VerificationStatus, string>;
  controls: Control[];
  requirements: Requirement[];
  search: string;
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      <form action={`/${lang}/controls`} className="flex flex-wrap gap-2" role="search">
        <label className="sr-only" htmlFor="control-search">{labels.search}</label>
        <input
          id="control-search"
          name="q"
          type="search"
          maxLength={120}
          defaultValue={search}
          placeholder={labels.search}
          className="min-w-64 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
        <button className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink">{labels.searchAction}</button>
      </form>

      {canManage && <CreateControlForm lang={lang} labels={labels} />}

      {controls.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-sm text-ink-muted">
          {search ? labels.noSearchResults : labels.noControls}
        </p>
      ) : (
        <div className="space-y-4">
          {controls.map((control) => (
            <article key={control.id} className="rounded-lg border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink">{control.code} · {control.title}</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    {control.domain || labels.noDomain} · {labels.sourceLabels[control.source as keyof typeof labels.sourceLabels] ?? control.source}
                  </p>
                </div>
                <span className="rounded-full bg-canvas px-3 py-1 text-xs text-ink-muted">
                  {labels.mappingCount}: {control.mappings.length}
                </span>
              </div>
              {control.description && <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{control.description}</p>}

              <section className="mt-5 border-t border-line pt-4">
                <h3 className="font-medium text-ink">{labels.mappedRequirements}</h3>
                {control.mappings.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-muted">{labels.noMappings}</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {control.mappings.map(({ id, rationale, requirement }) => (
                      <li key={id} className="rounded-md border border-line bg-canvas p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-ink">
                              {requirement.version.document.code} · {requirement.clauseId}
                              {requirement.topic ? ` · ${requirement.topic}` : ""}
                            </p>
                            <p className="mt-1 text-sm text-ink-muted">
                              {requirement.version.document.title} — {requirement.version.document.issuer}
                            </p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs ${requirement.verificationStatus === "VERIFIED" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                            {verification[requirement.verificationStatus as VerificationStatus] ?? requirement.verificationStatus}
                          </span>
                        </div>
                        {requirement.verificationStatus !== "VERIFIED" && (
                          <p className="mt-2 text-xs text-amber-900">{labels.pendingVerificationNotice}</p>
                        )}
                        {rationale && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{rationale}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {canManage && (
                <div className="mt-5 grid gap-5 border-t border-line pt-4 lg:grid-cols-2">
                  <UpdateControlForm lang={lang} labels={labels} control={control} />
                  <CreateMappingForm
                    lang={lang}
                    labels={labels}
                    control={control}
                    requirements={requirements.filter(({ id }) => !control.mappings.some((mapping) => mapping.requirement.id === id))}
                    verification={verification}
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {canManage && <p className="text-xs text-ink-muted">{labels.mappingHistoryNotice}</p>}
    </div>
  );
}

function CreateControlForm({ lang, labels }: { lang: string; labels: Labels }) {
  const [state, action, pending] = useActionState<ControlActionState, FormData>(createControlAction, null);
  return (
    <details className="rounded-lg border border-line bg-surface p-5">
      <summary className="cursor-pointer font-semibold text-teal-strong">{labels.createControl}</summary>
      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <ControlFields labels={labels} />
        <div className="sm:col-span-2">
          <Feedback state={state} labels={labels} />
          <button type="submit" disabled={pending} className="mt-3 rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {pending ? labels.saving : labels.saveControl}
          </button>
        </div>
      </form>
    </details>
  );
}

function UpdateControlForm({
  lang,
  labels,
  control,
}: {
  lang: string;
  labels: Labels;
  control: Control;
}) {
  const [state, action, pending] = useActionState<ControlActionState, FormData>(updateControlAction, null);
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-teal-strong">{labels.editControl}</summary>
      <form action={action} className="mt-3 grid gap-3">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="controlId" value={control.id} />
        <ControlFields labels={labels} control={control} />
        <Feedback state={state} labels={labels} />
        <button type="submit" disabled={pending} className="justify-self-start rounded-md border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60">
          {pending ? labels.saving : labels.saveControl}
        </button>
      </form>
    </details>
  );
}

function ControlFields({ labels, control }: { labels: Labels; control?: Control }) {
  return (
    <>
      <Field label={labels.code} name="code" defaultValue={control?.code} required maxLength={40} />
      <Field label={labels.title} name="title" defaultValue={control?.title} required maxLength={200} />
      <Field label={labels.domain} name="domain" defaultValue={control?.domain ?? ""} maxLength={120} />
      <label className="text-sm font-medium text-ink">
        {labels.source}
        <select name="source" defaultValue={control?.source ?? "INTERNAL"} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal">
          {Object.entries(labels.sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink sm:col-span-2">
        {labels.descriptionField}
        <textarea name="description" defaultValue={control?.description ?? ""} maxLength={4000} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal" />
      </label>
    </>
  );
}

function CreateMappingForm({
  lang,
  labels,
  control,
  requirements,
  verification,
}: {
  lang: string;
  labels: Labels;
  control: Control;
  requirements: Requirement[];
  verification: Record<VerificationStatus, string>;
}) {
  const [state, action, pending] = useActionState<ControlActionState, FormData>(createMappingAction, null);
  return (
    <form action={action} className="self-start">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="controlId" value={control.id} />
      <label className="block text-sm font-medium text-ink">
        {labels.addMapping}
        <select name="requirementId" required disabled={requirements.length === 0} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal">
          <option value="">{requirements.length === 0 ? labels.noAvailableRequirements : labels.chooseRequirement}</option>
          {requirements.map((requirement) => (
            <option key={requirement.id} value={requirement.id}>
              {requirement.version.document.code} · {requirement.clauseId} · {requirement.topic || labels.noTopic} ({verification[requirement.verificationStatus as VerificationStatus] ?? requirement.verificationStatus})
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-sm font-medium text-ink">
        {labels.rationale}
        <textarea name="rationale" required minLength={10} maxLength={2000} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal" />
      </label>
      <p className="mt-2 text-xs text-ink-muted">{labels.pendingVerificationNotice}</p>
      <Feedback state={state} labels={labels} />
      <button type="submit" disabled={pending || requirements.length === 0} className="mt-3 rounded-md border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60">
        {pending ? labels.saving : labels.mapRequirement}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  maxLength: number;
}) {
  return (
    <label className="text-sm font-medium text-ink">
      {label}
      <input name={name} defaultValue={defaultValue} required={required} maxLength={maxLength} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal" />
    </label>
  );
}

function Feedback({ state, labels }: { state: ControlActionState; labels: Labels }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="mt-2 text-sm text-rose-700">{labels.errors[state.error]}</p>;
  if (state.success) return <p role="status" className="mt-2 text-sm text-emerald-800">{labels.success[state.success]}</p>;
  return null;
}
