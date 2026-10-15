import "server-only";
import type { Locale } from "./config";
import en from "./dictionaries/en.json";

// UI strings only. Legal text lives in the database (original and translation stored
// separately) and is never part of these dictionaries.
export type Dictionary = typeof en;

const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  en: () => Promise.resolve(en),
  az: () => import("./dictionaries/az.json").then((m) => m.default),
};

export const getDictionary = (locale: Locale): Promise<Dictionary> => dictionaries[locale]();
