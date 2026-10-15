"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasLocale } from "@/i18n/config";
import { getPrisma } from "@/lib/db";
import { SESSION_COOKIE, SECURE_SESSION_COOKIE, sessionCookieName } from "@/lib/auth/dal";
import { loginWithPassword } from "@/lib/auth/service";

const loginSchema = z.object({
  lang: z.string().refine(hasLocale),
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export type LoginActionState = { error: "invalidCredentials" | "invalidInput" } | null;

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    lang: formData.get("lang"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalidCredentials" };

  const result = await loginWithPassword(
    getPrisma(),
    parsed.data.email,
    parsed.data.password,
  );
  if (!result.ok) return { error: "invalidCredentials" };

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: result.expiresAt,
    path: "/",
  });
  cookieStore.delete(
    sessionCookieName() === SESSION_COOKIE ? SECURE_SESSION_COOKIE : SESSION_COOKIE,
  );
  redirect(`/${parsed.data.lang}`);
}

