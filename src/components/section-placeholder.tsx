import type { Dictionary } from "@/i18n/get-dictionary";

type SectionKey = keyof Dictionary["sections"];

// Honest placeholder for modules that are not built yet. Shows no fake data.
export function SectionPlaceholder({ dict, section }: { dict: Dictionary; section: SectionKey }) {
  const s = dict.sections[section];
  return (
    <section>
      <h1 className="text-2xl font-semibold text-ink">{s.title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">{s.description}</p>
      <div className="mt-6 rounded-lg border border-dashed border-line bg-surface p-8">
        <p className="text-sm font-medium text-ink">{dict.common.notAvailableYet}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {dict.common.plannedFor} {s.phase}
        </p>
      </div>
    </section>
  );
}
