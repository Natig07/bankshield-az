// Deterministic, locale-table based date formatting.
//
// Intl.DateTimeFormat output depends on the ICU build of the runtime. The server (Node)
// and the visitor's browser can disagree ("18 okt 2026" vs "18 okt. 2026", or no `az`
// data at all), which makes React report a hydration mismatch. Months are therefore
// spelled from fixed tables and the date is always read in UTC, so every runtime
// renders the same text.
const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  az: ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avq", "sen", "okt", "noy", "dek"],
} as const;

export function formatDate(value: Date | string | number, lang: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const months = lang === "az" ? MONTHS.az : MONTHS.en;
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
