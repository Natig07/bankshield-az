// Explains why edit forms are hidden for an engagement whose status locks them.
// This is a usability aid only: every mutation is still refused server-side
// (see assertEngagementOperation).
export function EngagementLockNotice({ status, messages }: { status: string; messages: Record<string, string> }) {
  const text = messages[status];
  if (!text) return null;
  return (
    <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      {text}
    </p>
  );
}
