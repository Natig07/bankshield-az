export default function AuditsLoading() {
  return (
    <div aria-busy="true" className="space-y-5">
      <div className="h-8 w-56 animate-pulse rounded bg-line" />
      <div className="h-24 animate-pulse rounded-lg bg-surface" />
      <div className="h-20 animate-pulse rounded-lg bg-surface" />
      <div className="h-28 animate-pulse rounded-lg bg-surface" />
    </div>
  );
}
