import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { LanguageSwitcher } from "./language-switcher";
import { NavigationProgress } from "./navigation-progress";
import { SidebarNav } from "./sidebar-nav";
import { logoutAction } from "@/app/[lang]/actions";
import type { AuthUser } from "@/lib/auth/service";
import { SubmitButton } from "@/components/submit-button";

export function AppShell({
  lang,
  dict,
  user,
  children,
}: {
  lang: Locale;
  dict: Dictionary;
  user: AuthUser;
  children: React.ReactNode;
}) {
  const roleLabel = dict.roles[user.role];
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Suspense fallback={null}>
        <NavigationProgress label={dict.common.loading} />
      </Suspense>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink"
      >
        {dict.common.skipToContent}
      </a>
      <aside className="flex w-full shrink-0 flex-col bg-navy-900 md:sticky md:top-0 md:h-screen md:w-64">
        <div className="flex items-center gap-3 border-b border-navy-800 px-5 py-4">
          <ShieldCheck aria-hidden className="size-7 text-teal-accent" />
          <div>
            <p className="text-base font-semibold leading-tight text-white">{dict.app.name}</p>
            <p className="text-xs text-navy-300">{dict.app.tagline}</p>
          </div>
        </div>
        <SidebarNav
          lang={lang}
          labels={dict.nav}
          ariaLabel={dict.common.mainNavigation}
          role={user.role}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-3">
          <p className="max-w-3xl text-xs text-ink-muted">{dict.app.notice}</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-right text-xs">
              <p className="font-medium text-ink">{user.name} <span className="text-ink-muted">({user.email})</span></p>
              <p className="text-ink-muted">{roleLabel}</p>
            </div>
            <form action={logoutAction}>
              <input type="hidden" name="lang" value={lang} />
              <SubmitButton className="text-sm font-medium text-teal-strong underline underline-offset-2">
                {dict.auth.logout}
              </SubmitButton>
            </form>
            <LanguageSwitcher current={lang} label={dict.common.language} />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 px-6 py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
