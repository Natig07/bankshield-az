import "server-only";
import { notFound } from "next/navigation";
import { hasLocale } from "./config";
import { getDictionary } from "./get-dictionary";

// Validates the [lang] segment (layouts and pages render independently, so each page
// must validate it too) and loads the matching dictionary.
export async function loadLocale(params: Promise<{ lang: string }>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return { lang, dict: await getDictionary(lang) };
}
