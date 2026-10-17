"use client";

import type { Dictionary } from "@/i18n/get-dictionary";
import { SEVERITIES } from "@/lib/domain/enums";
import type { FindingActionState } from "./actions";

export type Labels = Dictionary["findingWorkflow"];
export const input = "mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal text-ink";
export const primary = "rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60";
export const secondary = "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60";

export function severityClass(severity: string) {
  return severity === "CRITICAL" ? "bg-rose-100 text-rose-900" : severity === "HIGH" ? "bg-orange-100 text-orange-900" : severity === "MEDIUM" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900";
}

export function Feedback({ state, labels }: { state: FindingActionState; labels: Labels }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-rose-800">{labels.errors[state.error]}</p>;
  if (state.success) return <p role="status" className="text-sm text-emerald-800">{labels.success[state.success]}</p>;
  return null;
}

type Defaults = {
  title?: string; description?: string; severity?: string; requirementId?: string | null;
  inherentLikelihood?: number | null; inherentImpact?: number | null; residualLikelihood?: number | null; residualImpact?: number | null;
};

export function FindingFields({ labels, requirements, defaults = {} }: { labels: Labels; requirements: { id: string; clauseId: string; topic: string | null }[]; defaults?: Defaults }) {
  const score = (name: string, label: string, value: number | null | undefined) => (
    <label className="text-sm font-medium text-ink">
      {label}
      <select name={name} defaultValue={value ?? ""} className={input}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <label className="text-sm font-medium text-ink md:col-span-2">{labels.fields.title}
        <input name="title" required minLength={3} maxLength={200} defaultValue={defaults.title} className={input} />
      </label>
      <label className="text-sm font-medium text-ink md:col-span-2">{labels.fields.description}
        <textarea name="description" required minLength={10} maxLength={4000} rows={3} defaultValue={defaults.description} className={input} />
      </label>
      <label className="text-sm font-medium text-ink">{labels.fields.severity}
        <select name="severity" required defaultValue={defaults.severity ?? "MEDIUM"} className={input}>
          {SEVERITIES.map((s) => <option key={s} value={s}>{labels.severities[s]}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">{labels.fields.requirement}
        <select name="requirementId" defaultValue={defaults.requirementId ?? ""} className={input}>
          <option value="">{labels.fields.noRequirement}</option>
          {requirements.map((r) => <option key={r.id} value={r.id}>{r.clauseId}{r.topic ? ` · ${r.topic}` : ""}</option>)}
        </select>
      </label>
      {score("inherentLikelihood", labels.fields.inherentLikelihood, defaults.inherentLikelihood)}
      {score("inherentImpact", labels.fields.inherentImpact, defaults.inherentImpact)}
      {score("residualLikelihood", labels.fields.residualLikelihood, defaults.residualLikelihood)}
      {score("residualImpact", labels.fields.residualImpact, defaults.residualImpact)}
      <p className="text-xs text-ink-muted md:col-span-2">{labels.fields.scoreHint}</p>
    </>
  );
}
