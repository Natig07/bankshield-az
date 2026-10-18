"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { MAX_EVIDENCE_BYTES } from "@/lib/evidence/validation";
import {
  reviewEvidenceAction,
  uploadEvidenceAction,
  type EvidenceActionState,
} from "./actions";
import { formatDate } from "@/lib/format/date";

type Labels = Dictionary["evidenceWorkflow"];
type Record = {
  id: string;
  engagementId: string;
  controlId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  reviewStatus: string;
  reviewNote: string | null;
  uploadedById: string;
  replacesId: string | null;
  engagement: { title: string; status: string };
  control: { code: string; title: string } | null;
};
type Target = { id: string; title: string; scopeItems: { control: { id: string; code: string; title: string } }[] };

export function EvidenceWorkspace({
  lang,
  labels,
  records,
  engagements,
  targets,
  selectedEngagement,
  canUpload,
  canReview,
  currentUserId,
  storageConfigured,
}: {
  lang: string;
  labels: Labels;
  records: Record[];
  engagements: { id: string; title: string }[];
  targets: Target[];
  selectedEngagement: string;
  canUpload: boolean;
  canReview: boolean;
  currentUserId: string;
  storageConfigured: boolean;
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{labels.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">{labels.description}</p>
      </header>

      {!storageConfigured && (
        <aside role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <p className="font-semibold">{labels.storageMissingTitle}</p>
          <p className="mt-1 text-sm">{labels.storageMissingBody}</p>
        </aside>
      )}
      <p className="text-xs text-ink-muted">{labels.scanNotice}</p>

      {canUpload && <UploadForm lang={lang} labels={labels} targets={targets} records={records} disabled={!storageConfigured} />}

      <form action={`/${lang}/evidence`} method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <div>
          <label htmlFor="evidence-engagement" className="mb-1 block text-sm font-medium text-ink">{labels.filterEngagement}</label>
          <select id="evidence-engagement" name="engagement" defaultValue={selectedEngagement} className="min-w-56 rounded-md border border-line bg-surface px-3 py-2 text-ink">
            <option value="">{labels.allEngagements}</option>
            {engagements.map((engagement) => <option key={engagement.id} value={engagement.id}>{engagement.title}</option>)}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white">{labels.apply}</button>
      </form>

      <section aria-labelledby="evidence-list-title" className="space-y-3">
        <h2 id="evidence-list-title" className="text-lg font-semibold text-ink">{labels.listTitle}</h2>
        {records.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">{labels.noEvidence}</p>
        ) : (
          <ul className="grid gap-3">
            {records.map((record) => (
              <li key={record.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-ink">{record.originalName}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      <Link href={`/${lang}/audits/${record.engagementId}`} className="text-teal-strong underline underline-offset-2">{record.engagement.title}</Link>
                      {" · "}
                      {record.control ? `${record.control.code} · ${record.control.title}` : labels.noControl}
                    </p>
                  </div>
                  <span className="rounded-full bg-canvas px-3 py-1 text-xs font-medium text-ink">
                    {labels.reviewStatuses[record.reviewStatus as keyof typeof labels.reviewStatuses] ?? record.reviewStatus}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-3">
                  <div><dt className="inline font-medium">{labels.size}: </dt><dd className="inline">{formatSize(record.sizeBytes)}</dd></div>
                  <div><dt className="inline font-medium">{labels.uploaded}: </dt><dd className="inline">{formatDate(record.uploadedAt, lang)}</dd></div>
                  <div className="sm:col-span-3 break-all"><dt className="inline font-medium">{labels.checksum}: </dt><dd className="inline font-mono">{record.sha256}</dd></div>
                </dl>
                {record.reviewNote && <p className="mt-2 text-sm text-ink">{record.reviewNote}</p>}
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  {/* Plain link: the browser sends the session cookie and the server authorises the download. */}
                  <a href={`/api/evidence/${record.id}`} className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink" download>
                    {labels.download}
                  </a>
                  {canReview && record.reviewStatus === "PENDING_REVIEW" && (
                    record.uploadedById === currentUserId ? (
                      <p className="text-sm text-ink-muted">{labels.independentNotice}</p>
                    ) : (
                      <ReviewForm lang={lang} labels={labels} evidenceId={record.id} />
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function UploadForm({
  lang,
  labels,
  targets,
  records,
  disabled,
}: {
  lang: string;
  labels: Labels;
  targets: Target[];
  records: Record[];
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<EvidenceActionState, FormData>(uploadEvidenceAction, null);
  const [engagementId, setEngagementId] = useState("");
  const target = targets.find(({ id }) => id === engagementId);
  const controls = new Map(target?.scopeItems.map(({ control }) => [control.id, control]));
  const replaceable = records.filter((record) => record.engagementId === engagementId && record.reviewStatus !== "SUPERSEDED");
  return (
    <details className="rounded-lg border border-line bg-surface" open={targets.length > 0}>
      <summary className="cursor-pointer px-5 py-4 text-lg font-semibold text-ink">{labels.uploadTitle}</summary>
      {targets.length === 0 ? (
        <p className="border-t border-line p-5 text-sm text-ink-muted">{labels.noUploadTargets}</p>
      ) : (
        <form action={action} className="grid gap-4 border-t border-line p-5 md:grid-cols-2">
          <input type="hidden" name="lang" value={lang} />
          <div>
            <label htmlFor="upload-engagement" className="mb-1 block text-sm font-medium text-ink">{labels.engagement}</label>
            <select id="upload-engagement" name="engagementId" required value={engagementId} onChange={(event) => setEngagementId(event.target.value)} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
              <option value="">{labels.chooseEngagement}</option>
              {targets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="upload-control" className="mb-1 block text-sm font-medium text-ink">{labels.control}</label>
            <select id="upload-control" name="controlId" defaultValue="" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
              <option value="">{labels.anyControl}</option>
              {[...controls.values()].map((control) => <option key={control.id} value={control.id}>{control.code} · {control.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="upload-file" className="mb-1 block text-sm font-medium text-ink">{labels.file}</label>
            <input id="upload-file" name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt,.csv" aria-describedby="upload-file-hint" onChange={(event) => {
              // Files above the Server Action body limit would be refused by the framework with a
              // generic full-page error, so oversized files are stopped here with the app's own
              // message. The server still enforces the limit independently.
              const input = event.currentTarget;
              const file = input.files?.[0];
              input.setCustomValidity(file && file.size > MAX_EVIDENCE_BYTES ? labels.errors.tooLarge : "");
              if (!input.validity.valid) input.reportValidity();
            }} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink" />
            <p id="upload-file-hint" className="mt-1 text-xs text-ink-muted">{labels.fileHint}</p>
          </div>
          <div>
            <label htmlFor="upload-replaces" className="mb-1 block text-sm font-medium text-ink">{labels.replaces}</label>
            <select id="upload-replaces" name="replacesId" defaultValue="" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
              <option value="">{labels.newEvidence}</option>
              {replaceable.map((record) => <option key={record.id} value={record.id}>{record.originalName}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <Feedback state={state} labels={labels} />
            <button type="submit" disabled={pending || disabled} className="mt-3 rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {pending ? labels.uploading : labels.upload}
            </button>
          </div>
        </form>
      )}
    </details>
  );
}

function ReviewForm({ lang, labels, evidenceId }: { lang: string; labels: Labels; evidenceId: string }) {
  const [state, action, pending] = useActionState<EvidenceActionState, FormData>(reviewEvidenceAction, null);
  return (
    <form action={action} className="grid min-w-64 flex-1 gap-2">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <fieldset className="flex gap-4 text-sm text-ink">
        <legend className="mb-1 font-medium">{labels.decision}</legend>
        <label className="flex items-center gap-1"><input type="radio" name="decision" value="ACCEPTED" required /> {labels.accept}</label>
        <label className="flex items-center gap-1"><input type="radio" name="decision" value="REJECTED" required /> {labels.reject}</label>
      </fieldset>
      <label className="text-sm font-medium text-ink">
        {labels.note}
        <textarea name="note" maxLength={1000} rows={2} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal" />
      </label>
      <Feedback state={state} labels={labels} />
      <button type="submit" disabled={pending} className="justify-self-start rounded-md border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-60">
        {pending ? labels.reviewing : labels.saveReview}
      </button>
    </form>
  );
}

function Feedback({ state, labels }: { state: EvidenceActionState; labels: Labels }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-rose-800">{labels.errors[state.error]}</p>;
  if (state.success) return <p role="status" className="text-sm text-emerald-800">{labels.success[state.success]}</p>;
  return null;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

