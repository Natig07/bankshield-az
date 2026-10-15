import { SectionPlaceholder } from "@/components/section-placeholder";
import { loadLocale } from "@/i18n/server";
import { requirePagePermission } from "@/lib/auth/dal";

export default async function Page({ params }: PageProps<"/[lang]/reports">) {
  const { lang, dict } = await loadLocale(params);
  await requirePagePermission(lang, "reports:read");
  return <SectionPlaceholder dict={dict} section="reports" />;
}
