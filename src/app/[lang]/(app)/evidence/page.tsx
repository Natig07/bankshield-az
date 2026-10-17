import { loadLocale } from "@/i18n/server";
import { getEngagementList, logEngagementQueryFailure } from "@/lib/audits/data";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { getEvidenceList, getUploadTargets } from "@/lib/evidence/data";
import { EvidenceWorkspace } from "./evidence-workspace";

export default async function EvidencePage({
  params,
  searchParams,
}: PageProps<"/[lang]/evidence">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "evidence:read");
  const query = await searchParams;
  const requested = Array.isArray(query.engagement) ? query.engagement[0] : query.engagement;
  const canUpload = hasPermission(user.role, "evidence:manage");
  const canReview = hasPermission(user.role, "evidence:review");

  let data: {
    records: Awaited<ReturnType<typeof getEvidenceList>>;
    engagements: { id: string; title: string }[];
    targets: Awaited<ReturnType<typeof getUploadTargets>>;
  };
  try {
    const prisma = getPrisma();
    const [records, engagements, targets] = await Promise.all([
      getEvidenceList(prisma, user, requested || undefined),
      getEngagementList(prisma, user, { search: "", status: "ALL" }),
      canUpload ? getUploadTargets(prisma, user) : Promise.resolve([]),
    ]);
    data = { records, engagements: engagements.map(({ id, title }) => ({ id, title })), targets };
  } catch (error) {
    logEngagementQueryFailure(error, "evidence");
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.evidenceWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.evidenceWorkflow.dataErrorBody}</p>
      </section>
    );
  }

  return (
    <EvidenceWorkspace
      lang={lang}
      labels={dict.evidenceWorkflow}
      records={data.records.map((record) => ({ ...record, uploadedAt: record.uploadedAt.toISOString() }))}
      engagements={data.engagements}
      targets={data.targets}
      selectedEngagement={requested ?? ""}
      canUpload={canUpload}
      canReview={canReview}
      currentUserId={user.id}
      storageConfigured={Boolean(process.env.EVIDENCE_STORAGE_DIR?.trim())}
    />
  );
}
