import { loadLocale } from "@/i18n/server";
import { hasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  getControlCatalogue,
  getRequirementsForMapping,
  logControlsQueryFailure,
  normalizeControlSearch,
} from "@/lib/controls/data";
import { ControlCatalogue } from "./control-catalogue";

export default async function ControlsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/controls">) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "controls:read");
  const query = await searchParams;
  const search = normalizeControlSearch(Array.isArray(query.q) ? query.q[0] : query.q);
  const canManage = hasPermission(user.role, "controls:manage");
  let controls: Awaited<ReturnType<typeof getControlCatalogue>>;
  let requirements: Awaited<ReturnType<typeof getRequirementsForMapping>> = [];

  try {
    const prisma = getPrisma();
    [controls, requirements] = await Promise.all([
      getControlCatalogue(prisma, search),
      canManage ? getRequirementsForMapping(prisma) : Promise.resolve([]),
    ]);
  } catch (error) {
    logControlsQueryFailure(error, "catalogue");
    return (
      <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <h1 className="font-semibold">{dict.controlWorkflow.dataErrorTitle}</h1>
        <p className="mt-2 text-sm">{dict.controlWorkflow.dataErrorBody}</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{dict.sections.controls.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">{dict.controlWorkflow.description}</p>
      </header>
      <ControlCatalogue
        lang={lang}
        labels={dict.controlWorkflow}
        verification={dict.verification}
        controls={controls.map((control) => ({
          ...control,
          mappings: control.mappings.map((mapping) => ({
            ...mapping,
            createdAt: mapping.createdAt.toISOString(),
          })),
        }))}
        requirements={requirements}
        search={search}
        canManage={canManage}
      />
    </section>
  );
}
