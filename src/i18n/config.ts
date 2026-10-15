export const LOCALES = ["az", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "az";

export function hasLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

// Pick a locale from an Accept-Language header. Falls back to the default (Azerbaijani).
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const weight = q ? Number.parseFloat(q.trim().slice(2)) : 1;
      return { lang: tag.toLowerCase().split("-")[0], weight: Number.isNaN(weight) ? 0 : weight };
    })
    .sort((a, b) => b.weight - a.weight);
  for (const { lang, weight } of ranked) {
    if (weight > 0 && hasLocale(lang)) return lang;
  }
  return DEFAULT_LOCALE;
}
