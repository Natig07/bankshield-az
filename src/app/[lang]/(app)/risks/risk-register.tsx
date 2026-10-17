"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ASSET_TYPES, RISK_CATEGORIES, RISK_STATUSES, SEVERITIES } from "@/lib/domain/enums";
import { createAssetAction, createRiskAction, type RiskActionState } from "./actions";
import { bandClass, Feedback, RiskFields, type AssetOption, type Labels } from "./risk-fields";

type Row = {
  id: string;
  code: string;
  title: string;
  category: string;
  status: string;
  ownerName: string;
  reviewDate: string | null;
  updatedAt: string;
  asset: { code: string; name: string } | null;
  inherentScore: number;
  residualScore: number | null;
  currentScore: number;
  currentBand: string;
  currentBasis: "INHERENT" | "RESIDUAL";
  openActions: number;
  overdueActions: number;
};

const field = "mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-normal text-ink";

export function RiskRegister({
  lang,
  labels,
  filters,
  canManage,
  summary,
  assets,
  risks,
}: {
  lang: string;
  labels: Labels;
  filters: { search: string; status: string; category: string; band: string };
  canManage: boolean;
  summary: { active: number; bands: Record<string, number>; overdueActions: number };
  assets: (AssetOption & { assetType: string; criticality: string; ownerName: string })[];
  risks: Row[];
}) {
  const filtered = filters.search || filters.status !== "ALL" || filters.category !== "ALL" || filters.band !== "ALL";
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{labels.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">{labels.description}</p>
        <p className="mt-2 max-w-3xl text-xs text-ink-muted">{labels.scoringNote}</p>
      </header>

      <section aria-labelledby="risk-summary" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <h2 id="risk-summary" className="sr-only">{labels.summaryTitle}</h2>
        <Tile label={labels.activeRisks} value={summary.active} />
        {SEVERITIES.map((band) => <Tile key={band} label={labels.bands[band]} value={summary.bands[band] ?? 0} tone={bandClass(band)} />)}
        <Tile label={labels.overdueActions} value={summary.overdueActions} />
      </section>

      {canManage && <CreateRisk lang={lang} labels={labels} assets={assets} />}

      <form action={`/${lang}/risks`} method="get" className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-medium text-ink lg:col-span-2">
          {labels.search}
          <input name="q" type="search" maxLength={120} defaultValue={filters.search} className={field} />
        </label>
        <Select name="status" label={labels.filterStatus} value={filters.status} all={labels.all} options={RISK_STATUSES.map((v) => [v, labels.statuses[v]])} />
        <Select name="category" label={labels.filterCategory} value={filters.category} all={labels.all} options={RISK_CATEGORIES.map((v) => [v, labels.categories[v]])} />
        <Select name="band" label={labels.filterBand} value={filters.band} all={labels.all} options={SEVERITIES.map((v) => [v, labels.bands[v]])} />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white">{labels.apply}</button>
          {filtered && <Link href={`/${lang}/risks`} className="rounded-md border border-line px-4 py-2 text-sm text-ink">{labels.clear}</Link>}
        </div>
      </form>

      {risks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">{filtered ? labels.noResults : labels.noRisks}</p>
      ) : (
        <ul className="grid gap-3">
          {risks.map((risk) => (
            <li key={risk.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-ink-muted">{risk.code} · {labels.categories[risk.category as keyof typeof labels.categories] ?? risk.category}</p>
                  <Link href={`/${lang}/risks/${risk.id}`} className="break-words text-lg font-semibold text-teal-strong underline-offset-2 hover:underline">{risk.title}</Link>
                  <p className="mt-1 text-sm text-ink-muted">{labels.fields.owner}: {risk.ownerName}{risk.asset ? ` · ${risk.asset.code} ${risk.asset.name}` : ""}</p>
                </div>
                <div className="text-right">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${bandClass(risk.currentBand)}`}>
                    {labels.bands[risk.currentBand as keyof typeof labels.bands]} · {risk.currentScore}
                  </span>
                  <p className="mt-1 text-xs text-ink-muted">{labels.fields.shownBasis}: {labels.basis[risk.currentBasis]}</p>
                </div>
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-4">
                <div><dt className="inline font-medium">{labels.fields.status}: </dt><dd className="inline">{labels.statuses[risk.status as keyof typeof labels.statuses] ?? risk.status}</dd></div>
                <div><dt className="inline font-medium">{labels.fields.inherent}: </dt><dd className="inline">{risk.inherentScore}</dd></div>
                <div><dt className="inline font-medium">{labels.fields.residual}: </dt><dd className="inline">{risk.residualScore ?? labels.fields.notAssessed}</dd></div>
                <div>
                  <dt className="inline font-medium">{labels.fields.openActions}: </dt>
                  <dd className="inline">{risk.openActions}{risk.overdueActions > 0 && <span className="ml-1 font-semibold text-rose-800">({risk.overdueActions} {labels.overdue})</span>}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <AssetsSection lang={lang} labels={labels} assets={assets} canManage={canManage} />
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-lg border border-line p-3 ${tone ?? "bg-surface"}`}>
      <p className="text-xs">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Select({ name, label, value, all, options }: { name: string; label: string; value: string; all: string; options: (readonly [string, string])[] }) {
  return (
    <label className="text-sm font-medium text-ink">
      {label}
      <select name={name} defaultValue={value} className={field}>
        <option value="ALL">{all}</option>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

function CreateRisk({ lang, labels, assets }: { lang: string; labels: Labels; assets: AssetOption[] }) {
  const [state, action, pending] = useActionState<RiskActionState, FormData>(createRiskAction, null);
  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-4 text-lg font-semibold text-ink">{labels.createTitle}</summary>
      <form action={action} className="grid gap-4 border-t border-line p-5 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <RiskFields labels={labels} assets={assets} />
        <div className="md:col-span-2">
          <Feedback state={state} labels={labels} />
          <button type="submit" disabled={pending} className="mt-3 rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? labels.creating : labels.create}</button>
        </div>
      </form>
    </details>
  );
}

function AssetsSection({ lang, labels, assets, canManage }: { lang: string; labels: Labels; assets: (AssetOption & { assetType: string; criticality: string; ownerName: string })[]; canManage: boolean }) {
  const [state, action, pending] = useActionState<RiskActionState, FormData>(createAssetAction, null);
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-5" aria-labelledby="assets-title">
      <h2 id="assets-title" className="text-lg font-semibold text-ink">{labels.assetsTitle}</h2>
      <p className="text-sm text-ink-muted">{labels.assetsHint}</p>
      {assets.length === 0 ? (
        <p className="text-sm text-ink-muted">{labels.noAssets}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {assets.map((asset) => (
            <li key={asset.id} className="py-2 text-ink">
              <span className="font-medium">{asset.code}</span> · {asset.name} · {labels.assetTypes[asset.assetType as keyof typeof labels.assetTypes] ?? asset.assetType} · {labels.bands[asset.criticality as keyof typeof labels.bands] ?? asset.criticality} · {asset.ownerName}
              {!asset.isActive && <span className="ml-2 text-xs text-ink-muted">(inactive)</span>}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form action={action} className="grid gap-3 border-t border-line pt-4 md:grid-cols-3">
          <input type="hidden" name="lang" value={lang} />
          <label className="text-sm font-medium text-ink">{labels.assetCode}<input name="code" required minLength={2} maxLength={40} className={field} /></label>
          <label className="text-sm font-medium text-ink md:col-span-2">{labels.assetName}<input name="name" required minLength={2} maxLength={200} className={field} /></label>
          <label className="text-sm font-medium text-ink">{labels.assetType}
            <select name="assetType" required className={field}>{ASSET_TYPES.map((t) => <option key={t} value={t}>{labels.assetTypes[t]}</option>)}</select>
          </label>
          <label className="text-sm font-medium text-ink">{labels.criticality}
            <select name="criticality" defaultValue="MEDIUM" className={field}>{SEVERITIES.map((t) => <option key={t} value={t}>{labels.bands[t]}</option>)}</select>
          </label>
          <label className="text-sm font-medium text-ink">{labels.fields.owner}<input name="ownerName" required minLength={2} maxLength={120} className={field} /></label>
          <div className="md:col-span-3">
            <Feedback state={state} labels={labels} />
            <button type="submit" disabled={pending} className="mt-2 rounded-md border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-60">{pending ? labels.addingAsset : labels.addAsset}</button>
          </div>
        </form>
      )}
    </section>
  );
}
