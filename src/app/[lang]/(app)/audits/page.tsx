import { SectionPlaceholder } from "@/components/section-placeholder";
import { loadLocale } from "@/i18n/server";
import { requirePagePermission } from "@/lib/auth/dal";

export default async function Page({ params }: PageProps<"/[lang]/audits">) {
  const { lang, dict } = await loadLocale(params);
  await requirePagePermission(lang, "audit:read");
  return <SectionPlaceholder dict={dict} section="audits" />;
}
