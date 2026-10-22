"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  Shield,
  FileText,
  LayoutDashboard,
  Scale,
  Settings,
  Sparkles,
  TriangleAlert,
  Files,
  ShieldAlert,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Role } from "@/lib/auth/authorization";
import { canSeeNavItem, NAV_ITEMS } from "@/lib/auth/nav-access";
import { Spinner } from "./spinner";

export interface NavLabels {
  dashboard: string;
  regulatory: string;
  audits: string;
  controls: string;
  evidence: string;
  aiReview: string;
  findings: string;
  risks: string;
  reports: string;
  admin: string;
}

const ICONS = {
  dashboard: LayoutDashboard,
  regulatory: Scale,
  audits: ClipboardList,
  controls: Shield,
  evidence: Files,
  aiReview: Sparkles,
  findings: TriangleAlert,
  risks: ShieldAlert,
  reports: FileText,
  admin: Settings,
} as const;

// Must render inside the Link it reports on. It appears only while that navigation is in flight.
function NavPending() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className="ml-auto size-3.5 text-teal-accent" /> : null;
}

export function SidebarNav({
  lang,
  labels,
  ariaLabel,
  role,
}: {
  lang: Locale;
  labels: NavLabels;
  ariaLabel: string;
  role: Role;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={ariaLabel} className="flex-1 overflow-y-auto px-3 py-4">
      <ul className="space-y-1">
        {NAV_ITEMS.filter(({ key }) => canSeeNavItem(role, key)).map(({ key, path }) => {
          const Icon = ICONS[key];
          const href = `/${lang}${path}`;
          const active = path === "" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-teal-accent bg-navy-800 font-medium text-white"
                    : "border-transparent text-navy-100 hover:bg-navy-800/60 hover:text-white"
                }`}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span>{labels[key]}</span>
                <NavPending />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
