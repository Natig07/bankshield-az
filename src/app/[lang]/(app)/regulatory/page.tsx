import { loadLocale } from "@/i18n/server";
import { requirePagePermission } from "@/lib/auth/dal";
import { hasPermission } from "@/lib/auth/authorization";
import { getPrisma } from "@/lib/db";
import { RegulatoryLibrary } from "./regulatory-library";

export default async function Page({ params }: PageProps<"/[lang]/regulatory">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "regulatory:read");
  const documents = await getPrisma().regulatoryDocument.findMany({
    orderBy: [{ code: "asc" }],
    select: {
      id: true,
      code: true,
      title: true,
      issuer: true,
      sourceUrl: true,
      kind: true,
      language: true,
      versions: {
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          versionLabel: true,
          sourceUrl: true,
          decisionNumber: true,
          decisionDate: true,
          effectiveFrom: true,
          effectiveTo: true,
          verificationStatus: true,
          verificationNotes: true,
          requirements: {
            orderBy: [{ clauseId: "asc" }],
            select: {
              id: true,
              clauseId: true,
              section: true,
              topic: true,
              textOriginal: true,
              textTranslation: true,
              translationLabel: true,
              translationSource: true,
              applicability: true,
              requirementType: true,
              verificationStatus: true,
              history: {
                orderBy: [{ createdAt: "desc" }],
                take: 10,
                select: { fromStatus: true, toStatus: true, note: true, createdAt: true },
              },
            },
          },
          history: {
            orderBy: [{ createdAt: "desc" }],
            take: 10,
            select: { fromStatus: true, toStatus: true, note: true, createdAt: true },
          },
        },
      },
    },
  });

  const serializedDocuments = documents.map((document) => ({
    ...document,
    versions: document.versions.map((version) => ({
      ...version,
      decisionDate: version.decisionDate?.toISOString() ?? null,
      effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
      effectiveTo: version.effectiveTo?.toISOString() ?? null,
      history: version.history.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
      requirements: version.requirements.map((requirement) => ({
        ...requirement,
        history: requirement.history.map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
        })),
      })),
    })),
  }));

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{dict.sections.regulatory.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">{dict.regulatoryLibrary.description}</p>
      </header>
      <RegulatoryLibrary
        documents={serializedDocuments}
        labels={dict.regulatoryLibrary}
        verification={dict.verification}
        lang={lang}
        canManage={hasPermission(user.role, "regulatory:manage")}
      />
    </section>
  );
}
