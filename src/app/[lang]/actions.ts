"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasLocale } from "@/i18n/config";
import { getPrisma } from "@/lib/db";
import {
  SESSION_COOKIE,
  SECURE_SESSION_COOKIE,
} from "@/lib/auth/dal";
import { revokeSession } from "@/lib/auth/service";

const localeSchema = z.string().refine(hasLocale);

export async function logoutAction(formData: FormData): Promise<never> {
  const parsedLocale = localeSchema.safeParse(formData.get("lang"));
  const lang = parsedLocale.success ? parsedLocale.data : "az";
  const cookieStore = await cookies();
  const token =
    cookieStore.get(SECURE_SESSION_COOKIE)?.value ??
    cookieStore.get(SESSION_COOKIE)?.value;

  await revokeSession(getPrisma(), token);
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(SECURE_SESSION_COOKIE);
  redirect(`/${lang}/login`);
}
