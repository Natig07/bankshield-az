import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthUser } from "./service";

export async function canAccessEngagement(
  db: PrismaClient,
  user: AuthUser,
  engagementId: string,
): Promise<boolean> {
  if (user.role === "ADMINISTRATOR") return true;
  const engagement = await db.auditEngagement.findFirst({
    where: {
      id: engagementId,
      OR: [
        { createdById: user.id },
        { members: { some: { userId: user.id } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(engagement);
}
