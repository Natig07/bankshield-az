import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { LOCALES, pickLocale } from "@/i18n/config";

// Locale routing only. Authorization is NOT enforced here: every Route Handler and
// Server Action must check the session and role itself (added in Phase 1).
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return NextResponse.next();

  const locale = pickLocale(request.headers.get("accept-language"));
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip API routes, Next internals, and files with an extension (favicon, images).
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
