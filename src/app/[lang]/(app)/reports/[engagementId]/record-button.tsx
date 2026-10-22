"use client";

import { useActionState } from "react";
import { recordReportAction, type ReportActionState } from "./actions";

type Labels = { recordButton: string; recording: string; recorded: string; recordNote: string; recordError: string };

export function RecordButton({ lang, engagementId, labels }: { lang: string; engagementId: string; labels: Labels }) {
  const [state, action, pending] = useActionState<ReportActionState, FormData>(recordReportAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="engagementId" value={engagementId} />
      <p className="text-sm text-ink-muted">{labels.recordNote}</p>
      <button type="submit" disabled={pending} className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? labels.recording : labels.recordButton}
      </button>
      <p role="status" className="text-sm">
        {state?.success ? <span className="text-emerald-800">{labels.recorded}</span> : null}
        {state?.error ? <span className="text-rose-800">{labels.recordError}</span> : null}
      </p>
    </form>
  );
}
