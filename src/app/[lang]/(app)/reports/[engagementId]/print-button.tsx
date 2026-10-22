"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink">
      {label}
    </button>
  );
}
