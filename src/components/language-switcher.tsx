"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALES, type Locale } from "@/i18n/config";

const NAMES: Record<Locale, string> = { az: "AZ", en: "EN" };
const FULL_NAMES: Record<Locale, string> = { az: "Azərbaycanca", en: "English" };

export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname();
  // Swap only the leading locale segment; keep the rest of the path.
  const rest = pathname.replace(/^\/(az|en)(?=\/|$)/, "");
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1 text-sm">
      {LOCALES.map((locale) => {
        const active = locale === current;
        return (
          <Link
            key={locale}
            href={`/${locale}${rest}`}
            lang={locale}
            hrefLang={locale}
            title={FULL_NAMES[locale]}
            aria-current={active ? "true" : undefined}
            className={`rounded px-2 py-1 font-medium ${
              active
                ? "bg-navy-900 text-white"
                : "text-ink-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            {NAMES[locale]}
          </Link>
        );
      })}
    </div>
  );
}
