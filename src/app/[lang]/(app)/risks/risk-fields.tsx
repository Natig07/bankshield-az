"use client";

import type { Dictionary } from "@/i18n/get-dictionary";
import { RISK_CATEGORIES, RISK_TREATMENTS } from "@/lib/domain/enums";
import type { RiskActionState } from "./actions";

export type Labels = Dictionary["riskWorkflow"];
export type AssetOption = { id: string; code: string; name: string; isActive: boolean };

const input = "mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal text-ink";

export function bandClass(band: string) {
  return band === "CRITICAL"
    ? "bg-rose-100 text-rose-900"
    : band === "HIGH"
      ? "bg-orange-100 text-orange-900"
      : band === "MEDIUM"
        ? "bg-amber-100 text-amber-900"
        : "bg-emerald-100 text-emerald-900";
}

export function Feedback({ state, labels }: { state: RiskActionState; labels: Labels }) {
  if (!state) return null;
  if (state.error === "invalidInput" && state.fields?.length) {
    const fieldLabels: { [field: string]: string } = {
      title: labels.fields.title, description: labels.fields.description, category: labels.fields.category,
      assetId: labels.fields.asset, ownerName: labels.fields.owner, treatment: labels.fields.treatment,
      inherentLikelihood: labels.fields.inherentLikelihood, inherentImpact: labels.fields.inherentImpact,
      residualLikelihood: labels.fields.residualLikelihood, residualImpact: labels.fields.residualImpact,
      reviewDate: labels.fields.reviewDate,
    };
    return (
      <div role="alert" className="text-sm text-rose-800">
        <p>{labels.errors.invalidInput}</p>
        <ul className="mt-1 list-disc pl-5">
          {state.fields.map((issue) => (
            <li key={`${issue.field}-${issue.code}`}>
              {issue.code === "residualPair" || issue.code === "residualAboveInherent"
                ? labels.fieldErrors[issue.code]
                : `${fieldLabels[issue.field] ?? issue.field}: ${labels.fieldErrors[issue.code].replace("{n}", String(issue.limit ?? ""))}`}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (state.error) return <p role="alert" className="text-sm text-rose-800">{labels.errors[state.error]}</p>;
  if (state.success) return <p role="status" className="text-sm text-emerald-800">{labels.success[state.success]}</p>;
  return null;
}

type Defaults = {
  title?: string;
  description?: string;
  category?: string;
  assetId?: string | null;
  ownerName?: string;
  inherentLikelihood?: number;
  inherentImpact?: number;
  residualLikelihood?: number | null;
  residualImpact?: number | null;
  treatment?: string | null;
  reviewDate?: string | null;
};

// Shared by the create and edit forms. Scores are numeric selects limited to the 1-5 scale.
export function RiskFields({ labels, assets, defaults = {} }: { labels: Labels; assets: AssetOption[]; defaults?: Defaults }) {
  const scale = [1, 2, 3, 4, 5];
  const score = (name: string, label: string, value: number | null | undefined, optional: boolean) => (
    <label className="text-sm font-medium text-ink">
      {label}
      <select name={name} defaultValue={value ?? ""} required={!optional} className={input}>
        {optional && <option value="">—</option>}
        {scale.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <label className="text-sm font-medium text-ink md:col-span-2">
        {labels.fields.title}
        <input name="title" required minLength={3} maxLength={200} defaultValue={defaults.title} className={input} />
      </label>
      <label className="text-sm font-medium text-ink md:col-span-2">
        {labels.fields.description}
        <textarea name="description" required minLength={10} maxLength={4000} rows={3} defaultValue={defaults.description} className={input} />
      </label>
      <label className="text-sm font-medium text-ink">
        {labels.fields.category}
        <select name="category" required defaultValue={defaults.category ?? "OTHER"} className={input}>
          {RISK_CATEGORIES.map((c) => <option key={c} value={c}>{labels.categories[c]}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        {labels.fields.asset}
        <select name="assetId" defaultValue={defaults.assetId ?? ""} className={input}>
          <option value="">{labels.fields.noAsset}</option>
          {assets.filter((a) => a.isActive || a.id === defaults.assetId).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        {labels.fields.owner}
        <input name="ownerName" required minLength={2} maxLength={120} defaultValue={defaults.ownerName} className={input} />
      </label>
      <label className="text-sm font-medium text-ink">
        {labels.fields.treatment}
        <select name="treatment" defaultValue={defaults.treatment ?? ""} className={input}>
          <option value="">{labels.fields.noTreatment}</option>
          {RISK_TREATMENTS.map((t) => <option key={t} value={t}>{labels.treatments[t]}</option>)}
        </select>
      </label>
      {score("inherentLikelihood", labels.fields.inherentLikelihood, defaults.inherentLikelihood, false)}
      {score("inherentImpact", labels.fields.inherentImpact, defaults.inherentImpact, false)}
      {score("residualLikelihood", labels.fields.residualLikelihood, defaults.residualLikelihood, true)}
      {score("residualImpact", labels.fields.residualImpact, defaults.residualImpact, true)}
      <p className="text-xs text-ink-muted md:col-span-2">{labels.fields.residualHint}</p>
      <label className="text-sm font-medium text-ink">
        {labels.fields.reviewDate}
        <input name="reviewDate" type="date" defaultValue={defaults.reviewDate?.slice(0, 10) ?? ""} className={input} />
      </label>
    </>
  );
}
