import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { loadLocale } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/dal";

export default async function LoginPage({ params }: PageProps<"/[lang]/login">) {
  const { lang, dict } = await loadLocale(params);
  if (await getCurrentUser()) redirect(`/${lang}`);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <section className="w-full max-w-md rounded-xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-lg font-semibold text-navy-900">{dict.app.name}</p>
        <h1 className="mt-6 text-2xl font-semibold text-ink">{dict.auth.loginTitle}</h1>
        <p className="mt-2 text-sm text-ink-muted">{dict.auth.loginDescription}</p>
        <LoginForm
          lang={lang}
          labels={{
            email: dict.auth.email,
            password: dict.auth.password,
            submit: dict.auth.login,
            submitting: dict.auth.loggingIn,
            invalidCredentials: dict.auth.invalidCredentials,
          }}
        />
      </section>
    </main>
  );
}
