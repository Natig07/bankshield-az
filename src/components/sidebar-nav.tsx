"use client";

import Link from "next/link";
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
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Role } from "@/lib/auth/authorization";
import { hasPermission } from "@/lib/auth/authorization";

export interface NavLabels {
  dashboard: string;
  regulatory: string;
  audits: string;
  controls: string;
  evidence: string;
  aiReview: string;
  findings: string;
  reports: string;
  admin: string;
}

const ITEMS = [
  { key: "dashboard", path: "", icon: LayoutDashboard },
  { key: "regulatory", path: "/regulatory", icon: Scale },
  { key: "audits", path: "/audits", icon: ClipboardList },
  { key: "controls", path: "/controls", icon: Shield },
  { key: "evidence", path: "/evidence", icon: Files },
  { key: "aiReview", path: "/ai-review", icon: Sparkles },
  { key: "findings", path: "/findings", icon: TriangleAlert },
  { key: "reports", path: "/reports", icon: FileText },
  { key: "admin", path: "/admin", icon: Settings },
] as const;

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
        {ITEMS.filter(({ key }) =>
          key === "admin"
            ? hasPermission(role, "users:manage")
            : key === "controls"
              ? hasPermission(role, "controls:read")
              : true,
        ).map(({ key, path, icon: Icon }) => {
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
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
