import type { VerificationStatus } from "@/lib/domain/enums";

const STYLES: Record<VerificationStatus, string> = {
  PENDING_VERIFICATION: "bg-amber-50 text-amber-900 ring-amber-300",
  UNDER_LEGAL_REVIEW: "bg-sky-50 text-sky-900 ring-sky-300",
  VERIFIED: "bg-emerald-50 text-emerald-900 ring-emerald-300",
  SUPERSEDED: "bg-slate-100 text-slate-700 ring-slate-300",
};

// Status is conveyed by text, not colour alone.
export function VerificationBadge({
  status,
  label,
}: {
  status: VerificationStatus;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {label}
    </span>
  );
}
