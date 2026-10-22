// Placeholder for a page's content while its data loads. The blocks echo the real layout (a
// heading, an intro line, two panels) without pretending to be content, and the sidebar and header
// stay in place around it. It is hidden from assistive technology: NavigationProgress announces
// "Loading" for the same navigation, and loading.tsx is not given the locale to translate a label.
export function PageSkeleton() {
  const block = "rounded-md bg-line/70 motion-safe:animate-pulse";
  return (
    <div aria-hidden className="space-y-6">
        <div className="space-y-3">
          <div className={`${block} h-7 w-64 max-w-full`} />
          <div className={`${block} h-4 w-full max-w-xl`} />
        </div>
        {[40, 52].map((width) => (
          <div key={width} className="space-y-3 rounded-lg border border-line bg-surface p-5">
            <div className={`${block} h-5`} style={{ width: `${width * 4}px`, maxWidth: "100%" }} />
            <div className={`${block} h-4 w-full`} />
            <div className={`${block} h-4 w-2/3`} />
          </div>
        ))}
    </div>
  );
}
