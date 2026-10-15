"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasLocale } from "@/i18n/config";
import { ROLES } from "@/lib/auth/authorization";
import { requirePermission } from "@/lib/auth/dal";
import { hashUserPassword, isDatabaseConstraintError } from "@/lib/auth/service";
import { getPrisma } from "@/lib/db";

const createUserSchema = z.object({
  lang: z.string().refine(hasLocale),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  role: z.enum(ROLES),
});

const roleSchema = z.object({
  lang: z.string().refine(hasLocale),
  userId: z.string().min(1),
  role: z.enum(ROLES),
});

const activeSchema = z.object({
  lang: z.string().refine(hasLocale),
  userId: z.string().min(1),
  isActive: z.enum(["true", "false"]),
});

export type UserActionState =
  | {
      error?: "invalidInput" | "userExists" | "userNotFound" | "lastAdministrator" | "cannotChangeSelf";
      success?: "userCreated" | "roleUpdated" | "accountUpdated";
    }
  | null;

export async function createUserAction(
  _previousState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  await requirePermission("users:manage");
  const parsed = createUserSchema.safeParse({
    lang: formData.get("lang"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: "invalidInput" };

  const { lang, email, name, password, role } = parsed.data;
  const prisma = getPrisma();
  if (await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } })) {
    return { error: "userExists" };
  }
  const passwordHash = await hashUserPassword(password);
  try {
    await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        role,
        preferredLocale: lang,
      },
    });
  } catch (error) {
    if (isDatabaseConstraintError(error, "P2002")) return { error: "userExists" };
    throw error;
  }
  revalidatePath(`/${lang}/admin`);
  return { success: "userCreated" };
}

export async function updateUserRoleAction(
  _previousState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("users:manage");
  const parsed = roleSchema.safeParse({
    lang: formData.get("lang"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: "invalidInput" };
  const { lang, userId, role } = parsed.data;
  if (actor.id === userId && actor.role !== role) return { error: "cannotChangeSelf" };

  const result = await getPrisma().$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) return "userNotFound" as const;
    if (target.isActive && target.role === "ADMINISTRATOR" && role !== "ADMINISTRATOR") {
      const activeAdmins = await tx.user.count({
        where: { role: "ADMINISTRATOR", isActive: true },
      });
      if (activeAdmins <= 1) return "lastAdministrator" as const;
    }
    await tx.user.update({ where: { id: userId }, data: { role } });
    if (target.role !== role) await tx.session.deleteMany({ where: { userId } });
    return "updated" as const;
  });
  if (result !== "updated") return { error: result };
  revalidatePath(`/${lang}/admin`);
  return { success: "roleUpdated" };
}

export async function updateUserActiveAction(
  _previousState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("users:manage");
  const parsed = activeSchema.safeParse({
    lang: formData.get("lang"),
    userId: formData.get("userId"),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) return { error: "invalidInput" };
  const { lang, userId, isActive } = parsed.data;
  const shouldBeActive = isActive === "true";
  if (actor.id === userId && !shouldBeActive) return { error: "cannotChangeSelf" };

  const result = await getPrisma().$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) return "userNotFound" as const;
    if (
      !shouldBeActive &&
      target.isActive &&
      target.role === "ADMINISTRATOR" &&
      (await tx.user.count({ where: { role: "ADMINISTRATOR", isActive: true } })) <= 1
    ) {
      return "lastAdministrator" as const;
    }
    await tx.user.update({ where: { id: userId }, data: { isActive: shouldBeActive } });
    if (!shouldBeActive) await tx.session.deleteMany({ where: { userId } });
    return "updated" as const;
  });
  if (result !== "updated") return { error: result };
  revalidatePath(`/${lang}/admin`);
  return { success: "accountUpdated" };
}
