import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { getPrisma } from "@/lib/db";
import type { Permission } from "./authorization";
import { assertRolePermission, hasPermission } from "./authorization";
import { canAccessEngagement } from "./resource-access";
import { resolveSession, type AuthUser } from "./service";

export const SESSION_COOKIE = "bankshield-session";
export const SECURE_SESSION_COOKIE = "__Host-bankshield-session";

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("You do not have permission to perform this operation.");
    this.name = "ForbiddenError";
  }
}

export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const cookieStore = await cookies();
  const token =
    cookieStore.get(SECURE_SESSION_COOKIE)?.value ??
    cookieStore.get(SESSION_COOKIE)?.value;
  return resolveSession(getPrisma(), token);
});

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requirePermission(permission: Permission): Promise<AuthUser> {
  const user = await requireUser();
  assertRolePermission(user.role, permission);
  return user;
}

export async function requirePagePermission(
  lang: Locale,
  permission: Permission,
): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${lang}/login`);
  if (!hasPermission(user.role, permission)) redirect(`/${lang}/forbidden`);
  return user;
}

export async function requireEngagementPermission(
  engagementId: string,
  permission: Permission,
): Promise<AuthUser> {
  const user = await requirePermission(permission);
  if (!(await canAccessEngagement(getPrisma(), user, engagementId))) {
    throw new ForbiddenError();
  }
  return user;
}

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}
