// Read-only inspection of the SQLite database named by DATABASE_URL.
// It opens the file with readonly:true, prints table row COUNTS and migration status only,
// and never prints row contents, user emails or the connection string. Safe to run against
// the development database; it cannot modify, reset or seed it.
import "dotenv/config";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function resolveDatabasePath(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) throw new Error("DATABASE_URL must be a file: SQLite URL.");
  const raw = url.slice("file:".length).split("?")[0];
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

const databasePath = resolveDatabasePath();
if (!existsSync(databasePath)) throw new Error(`Database file not found: ${path.basename(databasePath)}`);

const db = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  console.log(`Database file: ${path.basename(databasePath)}`);
  console.log(`Tables: ${tables.length}`);
  for (const { name } of tables) {
    const { count } = db.prepare(`SELECT COUNT(*) AS count FROM "${name.replace(/"/g, '""')}"`).get() as { count: number };
    console.log(`  ${name}: ${count}`);
  }

  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const onDisk = readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  let applied = new Map<string, { finished: boolean; rolledBack: boolean }>();
  if (tables.some(({ name }) => name === "_prisma_migrations")) {
    const rows = db.prepare("SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations").all() as {
      migration_name: string;
      finished_at: string | null;
      rolled_back_at: string | null;
    }[];
    applied = new Map(rows.map((r) => [r.migration_name, { finished: r.finished_at !== null, rolledBack: r.rolled_back_at !== null }]));
  }
  console.log("Migrations:");
  for (const name of onDisk) {
    const state = applied.get(name);
    console.log(`  ${name}: ${!state ? "PENDING (run: npx prisma migrate deploy)" : state.rolledBack ? "ROLLED BACK" : state.finished ? "applied" : "FAILED/UNFINISHED"}`);
  }
  for (const name of applied.keys()) if (!onDisk.includes(name)) console.log(`  ${name}: applied in database but missing on disk`);
} finally {
  db.close();
}
