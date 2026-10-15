import { AppShell } from "@/components/app-shell";
import { loadLocale } from "@/i18n/server";
import { requirePagePermission } from "@/lib/auth/dal";

export default async function AuthenticatedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang, dict } = await loadLocale(params);
  const user = await requirePagePermission(lang, "application:access");
  return (
    <AppShell lang={lang} dict={dict} user={user}>
      {children}
    </AppShell>
  );
}
