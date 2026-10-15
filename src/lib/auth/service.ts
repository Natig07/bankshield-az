import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { PrismaClient } from "@/generated/prisma/client";
import { isRole, type Role } from "./authorization";
import { createSessionToken, hashSessionToken, SESSION_TTL_MS } from "./session-core";

const PASSWORD_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const INITIAL_BOOTSTRAP_KEY = "initial-administrator";
const DUMMY_HASH = hash(randomBytes(32), PASSWORD_HASH_OPTIONS);

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  preferredLocale: string;
};

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; user: AuthUser }
  | { ok: false };

export async function loginWithPassword(
  db: PrismaClient,
  email: string,
  password: string,
  now = new Date(),
): Promise<LoginResult> {
  await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
  const normalizedEmail = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalizedEmail } });
  const passwordHash = user?.passwordHash ?? (await DUMMY_HASH);
  const passwordMatches = await verify(passwordHash, password);
  const isLocked = Boolean(user?.lockedUntil && user.lockedUntil > now);

  if (!user || !user.isActive || isLocked || !passwordMatches || !isRole(user.role)) {
    if (user?.isActive && !isLocked && !passwordMatches) {
      await db.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        });
        if (updated.failedLoginCount >= LOGIN_FAILURE_LIMIT) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: 0,
              lockedUntil: new Date(now.getTime() + LOGIN_LOCKOUT_MS),
            },
          });
        }
      });
    }
    return { ok: false };
  }

  const token = createSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const safeUser = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    const safeUser = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, email: true, name: true, role: true, preferredLocale: true },
    });
    const role = safeUser.role;
    if (!isRole(role)) {
      throw new Error("The account role is not recognized; refusing to create a session.");
    }
    await tx.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt,
      },
    });
    return { ...safeUser, role };
  });

  return { ok: true, token, expiresAt, user: safeUser };
}

export async function resolveSession(
  db: PrismaClient,
  token: string | undefined,
  now = new Date(),
): Promise<AuthUser | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          preferredLocale: true,
          isActive: true,
        },
      },
    },
  });
  if (!session) return null;

  if (session.expiresAt <= now || !session.user.isActive) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (!isRole(session.user.role)) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    preferredLocale: session.user.preferredLocale,
  };
}

export async function revokeSession(db: PrismaClient, token: string | undefined): Promise<void> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export async function bootstrapAdministrator(
  db: PrismaClient,
  input: { email: string; name: string; password: string },
  isProduction = process.env.NODE_ENV === "production",
): Promise<AuthUser> {
  if (isProduction) {
    throw new Error("Administrator bootstrap is disabled in production.");
  }
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("A valid administrator email is required.");
  }
  if (name.length < 2 || name.length > 120) {
    throw new Error("Administrator name must contain 2 to 120 characters.");
  }
  if (input.password.length < 12 || input.password.length > 128) {
    throw new Error("Administrator password must contain 12 to 128 characters.");
  }

  const passwordHash = await hash(input.password, PASSWORD_HASH_OPTIONS);
  const admin = await db.$transaction(async (tx) => {
    const existingAdmin = await tx.user.findFirst({
      where: { role: "ADMINISTRATOR" },
      select: { id: true },
    });
    const marker = await tx.bootstrapState.findUnique({
      where: { key: INITIAL_BOOTSTRAP_KEY },
      select: { key: true },
    });
    if (existingAdmin || marker) {
      throw new Error("Initial administrator setup has already been completed.");
    }

    await tx.bootstrapState.create({ data: { key: INITIAL_BOOTSTRAP_KEY } });
    return tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: "ADMINISTRATOR",
        preferredLocale: "az",
      },
      select: { id: true, email: true, name: true, role: true, preferredLocale: true },
    });
  });
  return { ...admin, role: "ADMINISTRATOR" };
}

export async function hashUserPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}

export function isDatabaseConstraintError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
