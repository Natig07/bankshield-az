"use client";

import Link from "next/link";
import { useActionState } from "react";
import { RISK_STATUSES } from "@/lib/domain/enums";
import { canTransitionRisk, isRiskEditable } from "@/lib/risks/workflow";
import {
  addTreatmentActionAction,
  linkControlAction,
  transitionRiskAction,
  unlinkControlAction,
  updateRiskAction,
  updateTreatmentActionAction,
  type RiskActionState,
} from "../actions";
import { bandClass, Feedback, RiskFields, type AssetOption, type Labels } from "../risk-fields";
import { formatDate } from "@/lib/format/date";
import { SubmitButton } from "@/components/submit-button";

type Risk = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  status: string;
  ownerName: string;
  treatment: string | null;
  reviewDate: string | null;
  revision: number;
  acceptanceJustification: string | null;
  acceptedAt: string | null;
  updatedAt: string;
  inherentLikelihood: number;
  inherentImpact: number;
  residualLikelihood: number | null;
  residualImpact: number | null;
  assetId: string | null;
  asset: { code: string; name: string } | null;
  controls: { id: string; control: { id: string; code: string; title: string } }[];
  actions: { id: string; title: string; description: string | null; ownerName: string; dueDate: string; status: string; completedAt: string | null; overdue: boolean }[];
  history: { id: string; revision: number; changeNote: string | null; createdAt: string }[];
  inherentScore: number;
  inherentBand: string;
  residualScore: number | null;
  residualBand: string | null;
  currentScore: number;
  currentBand: string;
  currentBasis: "INHERENT" | "RESIDUAL";
};

const field = "mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal text-ink";
const primary = "rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60";
const secondary = "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60";

const fmt = formatDate;

export function RiskDetails({
  lang,
  labels,
  canManage,
  canAccept,
  assets,
  controls,
  risk,
}: {
  lang: string;
  labels: Labels;
  canManage: boolean;
  canAccept: boolean;
  assets: AssetOption[];
  controls: { id: string; code: string; title: string }[];
  risk: Risk;
}) {
  const editable = isRiskEditable(risk.status);
  const linked = new Set(risk.controls.map((c) => c.control.id));
  return (
    <div className="space-y-6">
      <Link href={`/${lang}/risks`} className="text-sm text-teal-strong underline-offset-2 hover:underline">← {labels.backToList}</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{risk.code} · {labels.categories[risk.category as keyof typeof labels.categories] ?? risk.category}</p>
          <h1 className="break-words text-2xl font-semibold text-ink">{risk.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {labels.statuses[risk.status as keyof typeof labels.statuses]} · {labels.fields.owner}: {risk.ownerName}
            {risk.asset ? ` · ${risk.asset.code} ${risk.asset.name}` : ""} · {labels.fields.revision} {risk.revision}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${bandClass(risk.currentBand)}`}>
          {labels.bands[risk.currentBand as keyof typeof labels.bands]} · {risk.currentScore}
        </span>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Score label={labels.fields.inherent} score={risk.inherentScore} band={risk.inherentBand} labels={labels} detail={`${risk.inherentLikelihood} × ${risk.inherentImpact}`} />
        <Score
          label={labels.fields.residual}
          score={risk.residualScore}
          band={risk.residualBand}
          labels={labels}
          detail={risk.residualLikelihood !== null ? `${risk.residualLikelihood} × ${risk.residualImpact}` : undefined}
        />
        <div className="rounded-lg border border-line bg-surface p-3 text-sm text-ink">
          <p className="text-xs text-ink-muted">{labels.fields.shownBasis}</p>
          <p className="mt-1 font-medium">{labels.basis[risk.currentBasis]}</p>
          {risk.reviewDate && <p className="mt-1 text-xs text-ink-muted">{labels.fields.reviewDate}: {fmt(risk.reviewDate, lang)}</p>}
        </div>
      </section>

      <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-sm text-ink">{risk.description}</p>

      {risk.status === "ACCEPTED" && risk.acceptanceJustification && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h2 className="font-semibold">{labels.acceptanceNotice}</h2>
          <p className="mt-1 whitespace-pre-wrap">{risk.acceptanceJustification}</p>
          {risk.acceptedAt && <p className="mt-1 text-xs">{labels.acceptedBy} · {fmt(risk.acceptedAt, lang)}</p>}
        </section>
      )}

      {canManage && !editable && <p className="rounded-md border border-line bg-surface p-3 text-sm text-ink-muted">{labels.lockedNotice}</p>}
      {canManage && editable && <EditRisk lang={lang} labels={labels} assets={assets} risk={risk} />}
      {canManage && <StatusForm lang={lang} labels={labels} risk={risk} canAccept={canAccept} />}

      <section className="space-y-3 rounded-lg border border-line bg-surface p-5" aria-labelledby="risk-controls">
        <h2 id="risk-controls" className="text-lg font-semibold text-ink">{labels.controlsTitle}</h2>
        {risk.controls.length === 0 ? <p className="text-sm text-ink-muted">{labels.noControls}</p> : (
          <ul className="divide-y divide-line text-sm">
            {risk.controls.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-ink">
                <span>{c.control.code} · {c.control.title}</span>
                {canManage && editable && <UnlinkForm lang={lang} labels={labels} riskId={risk.id} controlId={c.control.id} />}
              </li>
            ))}
          </ul>
        )}
        {canManage && editable && <LinkForm lang={lang} labels={labels} riskId={risk.id} controls={controls.filter((c) => !linked.has(c.id))} />}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-5" aria-labelledby="risk-actions">
        <h2 id="risk-actions" className="text-lg font-semibold text-ink">{labels.actionsTitle}</h2>
        {risk.actions.length === 0 ? <p className="text-sm text-ink-muted">{labels.noActions}</p> : (
          <ul className="space-y-3">
            {risk.actions.map((a) => {
              const active = a.status === "OPEN" || a.status === "IN_PROGRESS";
              return (
                <li key={a.id} className="rounded-md border border-line p-3 text-sm text-ink">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{a.title}</p>
                      {a.description && <p className="mt-1 whitespace-pre-wrap text-ink-muted">{a.description}</p>}
                      <p className="mt-1 text-xs text-ink-muted">
                        {a.ownerName} · {labels.dueDate}: {fmt(a.dueDate, lang)} · {labels.actionStatuses[a.status as keyof typeof labels.actionStatuses]}
                        {a.overdue && <span className="ml-1 font-semibold text-rose-800">· {labels.overdue}</span>}
                      </p>
                    </div>
                    {canManage && active && (
                      <div className="flex flex-wrap gap-2">
                        {(a.status === "OPEN" ? ["IN_PROGRESS", "DONE", "CANCELLED"] : ["DONE", "CANCELLED"]).map((target) => (
                          <ActionStatusForm key={target} lang={lang} labels={labels} riskId={risk.id} actionId={a.id} target={target} />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {canManage && editable && <AddAction lang={lang} labels={labels} riskId={risk.id} />}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-5" aria-labelledby="risk-history">
        <h2 id="risk-history" className="text-lg font-semibold text-ink">{labels.historyTitle}</h2>
        {risk.history.length === 0 ? <p className="text-sm text-ink-muted">{labels.noHistory}</p> : (
          <ol className="space-y-2 text-sm text-ink">
            {risk.history.map((h) => (
              <li key={h.id}>
                <span className="font-medium">{labels.revisionLabel} {h.revision}</span> · {fmt(h.createdAt, lang)}
                {h.changeNote ? ` — ${h.changeNote}` : ""}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Score({ label, score, band, labels, detail }: { label: string; score: number | null; band: string | null; labels: Labels; detail?: string }) {
  return (
    <div className={`rounded-lg border border-line p-3 text-sm ${band ? bandClass(band) : "bg-surface text-ink"}`}>
      <p className="text-xs">{label}</p>
      <p className="mt-1 text-xl font-semibold">{score ?? labels.fields.notAssessed}</p>
      {band && <p className="text-xs">{labels.bands[band as keyof typeof labels.bands]}{detail ? ` · ${detail}` : ""}</p>}
    </div>
  );
}

function EditRisk({ lang, labels, assets, risk }: { lang: string; labels: Labels; assets: AssetOption[]; risk: Risk }) {
  const [state, action, pending] = useActionState<RiskActionState, FormData>(updateRiskAction, null);
  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-4 text-lg font-semibold text-ink">{labels.editTitle}</summary>
      <form action={action} className="grid gap-4 border-t border-line p-5 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="riskId" value={risk.id} />
        <input type="hidden" name="expectedRevision" value={risk.revision} />
        <RiskFields labels={labels} assets={assets} defaults={risk} />
        <div className="md:col-span-2">
          <Feedback state={state} labels={labels} />
          <SubmitButton disabled={pending} className={`mt-3 ${primary}`}>{pending ? labels.saving : labels.save}</SubmitButton>
        </div>
      </form>
    </details>
  );
}

function StatusForm({ lang, labels, risk, canAccept }: { lang: string; labels: Labels; risk: Risk; canAccept: boolean }) {
  const [state, action, pending] = useActionState<RiskActionState, FormData>(transitionRiskAction, null);
  const targets = RISK_STATUSES.filter((s) => canTransitionRisk(risk.status, s) && (s !== "ACCEPTED" || canAccept));
  if (targets.length === 0) return null;
  return (
    <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="risk-status">
      <h2 id="risk-status" className="text-lg font-semibold text-ink">{labels.statusTitle}</h2>
      <form action={action} className="mt-3 grid gap-3 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="riskId" value={risk.id} />
        <input type="hidden" name="expectedRevision" value={risk.revision} />
        <label className="text-sm font-medium text-ink">
          {labels.targetStatus}
          <select name="targetStatus" required className={field}>
            {targets.map((s) => <option key={s} value={s}>{labels.statuses[s]}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">
          {labels.note}
          <input name="note" required minLength={3} maxLength={500} className={field} />
        </label>
        {canAccept && (
          <label className="text-sm font-medium text-ink md:col-span-2">
            {labels.acceptanceJustification}
            <textarea name="acceptanceJustification" maxLength={2000} rows={2} className={field} />
          </label>
        )}
        <div className="md:col-span-2">
          <Feedback state={state} labels={labels} />
          <SubmitButton disabled={pending} className={`mt-2 ${primary}`}>{pending ? labels.changingStatus : labels.changeStatus}</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function LinkForm({ lang, labels, riskId, controls }: { lang: string; labels: Labels; riskId: string; controls: { id: string; code: string; title: string }[] }) {
  const [state, action, pending] = useActionState<RiskActionState, FormData>(linkControlAction, null);
  if (controls.length === 0) return null;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="riskId" value={riskId} />
      <label className="min-w-0 flex-1 text-sm font-medium text-ink">
        {labels.chooseControl}
        <select name="controlId" required className={field}>
          {controls.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
        </select>
      </label>
      <SubmitButton disabled={pending} className={primary}>{pending ? labels.linking : labels.linkControl}</SubmitButton>
      <div className="w-full"><Feedback state={state} labels={labels} /></div>
    </form>
  );
}

function UnlinkForm({ lang, labels, riskId, controlId }: { lang: string; labels: Labels; riskId: string; controlId: string }) {
  const [state, action, pending] = useActionState<RiskActionState, FormData>(unlinkControlAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="riskId" value={riskId} />
      <input type="hidden" name="controlId" value={controlId} />
      <Feedback state={state} labels={labels} />
      <SubmitButton disabled={pending} className={secondary}>{labels.unlink}</SubmitButton>
    </form>
  );
}

function ActionStatusForm({ lang, labels, riskId, actionId, target }: { lang: string; labels: Labels; riskId: string; actionId: string; target: string }) {
  const [state, formAction, pending] = useActionState<RiskActionState, FormData>(updateTreatmentActionAction, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="riskId" value={riskId} />
      <input type="hidden" name="actionId" value={actionId} />
      <input type="hidden" name="targetStatus" value={target} />
      <SubmitButton disabled={pending} className={secondary}>
        {labels.markStatus} {labels.actionStatuses[target as keyof typeof labels.actionStatuses]}
      </SubmitButton>
      {state?.error && <span role="alert" className="ml-2 text-xs text-rose-800">{labels.errors[state.error]}</span>}
    </form>
  );
}

function AddAction({ lang, labels, riskId }: { lang: string; labels: Labels; riskId: string }) {
  const [state, action, pending] = useActionState<RiskActionState, FormData>(addTreatmentActionAction, null);
  return (
    <form action={action} className="grid gap-3 border-t border-line pt-4 md:grid-cols-3">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="riskId" value={riskId} />
      <label className="text-sm font-medium text-ink md:col-span-3">{labels.actionTitle}<input name="title" required minLength={3} maxLength={200} className={field} /></label>
      <label className="text-sm font-medium text-ink md:col-span-3">{labels.fields.description}<textarea name="description" maxLength={2000} rows={2} className={field} /></label>
      <label className="text-sm font-medium text-ink md:col-span-2">{labels.actionOwner}<input name="ownerName" required minLength={2} maxLength={120} className={field} /></label>
      <label className="text-sm font-medium text-ink">{labels.dueDate}<input name="dueDate" type="date" required className={field} /></label>
      <div className="md:col-span-3">
        <Feedback state={state} labels={labels} />
        <SubmitButton disabled={pending} className={`mt-2 ${primary}`}>{pending ? labels.addingAction : labels.addAction}</SubmitButton>
      </div>
    </form>
  );
}
