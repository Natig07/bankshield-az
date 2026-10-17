import { hasPermission, type Permission } from "./authorization";

// Sidebar entries and the permission each destination page enforces. The sidebar must show
// an entry only when the user could open the page, otherwise users are sent to a
// "forbidden" page by their own navigation. nav-access.test.ts compares this table with the
// requirePagePermission() call in every page file so the two cannot drift apart.
export const NAV_ITEMS = [
  { key: "dashboard", path: "", permission: "application:access" },
  { key: "regulatory", path: "/regulatory", permission: "regulatory:read" },
  { key: "audits", path: "/audits", permission: "audit:read" },
  { key: "controls", path: "/controls", permission: "controls:read" },
  { key: "evidence", path: "/evidence", permission: "evidence:read" },
  { key: "aiReview", path: "/ai-review", permission: "audit:read" },
  { key: "findings", path: "/findings", permission: "findings:read" },
  { key: "risks", path: "/risks", permission: "risks:read" },
  { key: "reports", path: "/reports", permission: "reports:read" },
  { key: "admin", path: "/admin", permission: "users:manage" },
] as const satisfies readonly { key: string; path: string; permission: Permission }[];

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

export function canSeeNavItem(role: string, key: NavKey): boolean {
  const item = NAV_ITEMS.find((candidate) => candidate.key === key);
  return item !== undefined && hasPermission(role, item.permission);
}
