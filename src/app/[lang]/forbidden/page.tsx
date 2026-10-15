import Link from "next/link";
import { loadLocale } from "@/i18n/server";

export default async function ForbiddenPage({ params }: PageProps<"/[lang]/forbidden">) {
  const { lang, dict } = await loadLocale(params);
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <section className="max-w-lg rounded-xl border border-line bg-surface p-8 text-center">
        <h1 className="text-2xl font-semibold text-ink">{dict.auth.accessDeniedTitle}</h1>
        <p className="mt-3 text-sm text-ink-muted">{dict.auth.accessDeniedDescription}</p>
        <Link className="mt-6 inline-block text-sm font-medium text-teal-strong underline" href={`/${lang}`}>
          {dict.auth.returnToDashboard}
        </Link>
      </section>
    </main>
  );
}
