export const ROLES = [
  "ADMINISTRATOR",
  "AUDITOR",
  "SECURITY_ANALYST",
  "READ_ONLY_REVIEWER",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "application:access",
  "application:manage",
  "regulatory:read",
  "regulatory:manage",
  "audit:read",
  "audit:manage",
  "evidence:read",
  "evidence:manage",
  "controls:read",
  "controls:assess",
  "findings:read",
  "findings:manage",
  "reports:read",
  "reports:manage",
  "users:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class PermissionDeniedError extends Error {
  constructor() {
    super("You do not have permission to perform this operation.");
    this.name = "PermissionDeniedError";
  }
}

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMINISTRATOR: PERMISSIONS,
  AUDITOR: [
    "application:access",
    "regulatory:read",
    "audit:read",
    "audit:manage",
    "evidence:read",
    "controls:read",
    "controls:assess",
    "findings:read",
    "findings:manage",
    "reports:read",
    "reports:manage",
  ],
  SECURITY_ANALYST: [
    "application:access",
    "regulatory:read",
    "audit:read",
    "evidence:read",
    "evidence:manage",
    "controls:read",
    "controls:assess",
    "findings:read",
  ],
  READ_ONLY_REVIEWER: [
    "application:access",
    "regulatory:read",
    "audit:read",
    "evidence:read",
    "controls:read",
    "findings:read",
    "reports:read",
  ],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function hasPermission(role: string, permission: Permission): boolean {
  return isRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}

export function assertRolePermission(
  role: string | null,
  permission: Permission,
): asserts role is Role {
  if (!role) throw new AuthenticationRequiredError();
  if (!hasPermission(role, permission)) throw new PermissionDeniedError();
}
