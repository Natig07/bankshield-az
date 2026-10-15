import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  bankshieldPrisma?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to access the BankShield database.");
  }

  if (!globalForPrisma.bankshieldPrisma) {
    globalForPrisma.bankshieldPrisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url }),
    });
  }

  return globalForPrisma.bankshieldPrisma;
}
