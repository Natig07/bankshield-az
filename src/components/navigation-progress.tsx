"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// A thin bar across the top of the window while an in-app link is being followed. It covers every
// internal link, including detail pages that cannot have a loading.tsx skeleton (see
// route-guards.test.ts). It starts on click and ends when the address changes; a timer clears it
// if the navigation never lands (for example, when the request fails).
export function NavigationProgress({ label }: { label: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = `${pathname}?${search}`;
  // Remember the address the click started from. Once the address changes the bar is off, with no
  // effect needed to switch it back.
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const active = startedAt === here;

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setStartedAt(`${window.location.pathname}?${window.location.search.slice(1)}`);
    }
    // Capture phase: next/link calls preventDefault() on the click it handles, so a listener on the
    // bubble phase would see defaultPrevented and skip every in-app link.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Forget a finished navigation so returning to the same address later does not switch the bar on.
  useEffect(() => {
    if (startedAt === null || startedAt === here) return;
    const timer = window.setTimeout(() => setStartedAt(null), 0);
    return () => window.clearTimeout(timer);
  }, [startedAt, here]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setStartedAt(null), 15000);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!active) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-teal-accent/20 print:hidden">
      <span className="sr-only">{label}</span>
      <div className="nav-progress h-full w-1/3 bg-teal-accent" />
    </div>
  );
}
