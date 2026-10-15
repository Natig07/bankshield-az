import { loadLocale } from "@/i18n/server";
import { requirePagePermission } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import { UserManagement } from "./user-management";

export default async function Page({ params }: PageProps<"/[lang]/admin">) {
  const { lang, dict } = await loadLocale(params);
  await requirePagePermission(lang, "users:manage");
  const users = await getPrisma().user.findMany({
    orderBy: [{ createdAt: "asc" }, { email: "asc" }],
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
  });
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{dict.users.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{dict.users.description}</p>
      </header>
      <UserManagement users={users} labels={dict.users} roles={dict.roles} lang={lang} />
    </div>
  );
}
