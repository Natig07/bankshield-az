export default function EngagementLoading() {
  return (
    <div aria-busy="true" className="space-y-5">
      <div className="h-8 w-48 animate-pulse rounded bg-line" />
      <div className="h-48 animate-pulse rounded-lg bg-surface" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-28 animate-pulse rounded-lg bg-surface" />
        <div className="h-28 animate-pulse rounded-lg bg-surface" />
        <div className="h-28 animate-pulse rounded-lg bg-surface" />
      </div>
    </div>
  );
}
