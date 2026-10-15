import { SectionPlaceholder } from "@/components/section-placeholder";
import { loadLocale } from "@/i18n/server";
import { requirePagePermission } from "@/lib/auth/dal";

export default async function Page({ params }: PageProps<"/[lang]/regulatory">) {
  const { lang, dict } = await loadLocale(params);
  await requirePagePermission(lang, "regulatory:read");
  return <SectionPlaceholder dict={dict} section="regulatory" />;
}
