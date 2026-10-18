import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// Guards against drift between prisma/schema.prisma and the SQL in prisma/migrations.
// It applies every migration to a throw-away database and compares the result with the
// schema: tables, columns, types, nullability, indexes and foreign-key delete rules.
// This supplements `prisma migrate status`/`migrate diff` (which need the schema engine)
// and is especially useful for hand-reviewed migrations.

type Field = { name: string; type: string; optional: boolean; list: boolean; attrs: string };
type Model = { name: string; fields: Field[]; blockAttrs: string[] };

const SCALARS: Record<string, string> = { String: "TEXT", Int: "INTEGER", Boolean: "BOOLEAN", DateTime: "DATETIME", Float: "REAL", BigInt: "BIGINT" };

function parseSchema(source: string): Model[] {
  const models: Model[] = [];
  let current: Model | null = null;
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const open = /^model\s+(\w+)\s*\{$/.exec(line);
    if (open) {
      current = { name: open[1], fields: [], blockAttrs: [] };
      continue;
    }
    if (!current) continue;
    if (line === "}") {
      models.push(current);
      current = null;
      continue;
    }
    if (!line) continue;
    if (line.startsWith("@@")) {
      current.blockAttrs.push(line);
      continue;
    }
    const field = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
    if (field) current.fields.push({ name: field[1], type: field[2], list: Boolean(field[3]), optional: Boolean(field[4]), attrs: field[5] });
  }
  return models;
}

function columnsOf(attr: string): string[] {
  const match = /\[([^\]]*)\]/.exec(attr);
  return match ? match[1].split(",").map((part) => part.trim()).filter(Boolean) : [];
}

test("applied migrations match prisma/schema.prisma", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bankshield-drift-"));
  const db = new Database(path.join(directory, "drift.db"));
  try {
    const root = path.join(process.cwd(), "prisma", "migrations");
    for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      db.exec(readFileSync(path.join(root, entry.name, "migration.sql"), "utf8"));
    }
    const models = parseSchema(readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8"));
    const modelNames = new Set(models.map(({ name }) => name));
    assert.ok(models.length > 20);

    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_prisma%' ESCAPE '\\'").all() as { name: string }[]).map(({ name }) => name));
    assert.deepEqual([...tables].sort(), [...modelNames].sort(), "tables must equal models");

    for (const model of models) {
      const scalars = model.fields.filter((field) => field.type in SCALARS && !field.list);
      const info = db.prepare(`PRAGMA table_info("${model.name}")`).all() as { name: string; type: string; notnull: number; pk: number }[];
      assert.deepEqual(info.map(({ name }) => name).sort(), scalars.map(({ name }) => name).sort(), `${model.name}: columns`);
      for (const field of scalars) {
        const column = info.find(({ name }) => name === field.name)!;
        assert.equal(column.type, SCALARS[field.type], `${model.name}.${field.name}: type`);
        const isPrimaryKey = /@id\b/.test(field.attrs);
        // SQLite reports PRIMARY KEY columns as notnull only when declared NOT NULL; Prisma always declares it.
        assert.equal(column.notnull === 1, !field.optional, `${model.name}.${field.name}: nullability`);
        assert.equal(column.pk === 1, isPrimaryKey, `${model.name}.${field.name}: primary key`);
      }

      const expected = new Set<string>();
      for (const field of scalars) if (/@unique\b/.test(field.attrs)) expected.add(`U:${field.name}`);
      for (const attr of model.blockAttrs) {
        if (attr.startsWith("@@unique")) expected.add(`U:${columnsOf(attr).join(",")}`);
        if (attr.startsWith("@@index")) expected.add(`I:${columnsOf(attr).join(",")}`);
      }
      const actual = new Set<string>();
      for (const index of db.prepare(`PRAGMA index_list("${model.name}")`).all() as { name: string; unique: number; origin: string; partial: number }[]) {
        if (index.origin === "pk" || index.partial === 1) continue; // primary key / hand-written partial index
        const cols = (db.prepare(`PRAGMA index_info("${index.name}")`).all() as { name: string; seqno: number }[]).sort((a, b) => a.seqno - b.seqno).map(({ name }) => name);
        actual.add(`${index.unique ? "U" : "I"}:${cols.join(",")}`);
      }
      assert.deepEqual([...actual].sort(), [...expected].sort(), `${model.name}: indexes`);

      const expectedKeys = new Set<string>();
      for (const field of model.fields) {
        const relation = /@relation\((.*)\)/.exec(field.attrs);
        if (!relation || !modelNames.has(field.type) || !/fields:/.test(relation[1])) continue;
        const from = columnsOf(/fields:\s*(\[[^\]]*\])/.exec(relation[1])![1]);
        const rule = /onDelete:\s*(\w+)/.exec(relation[1])?.[1] ?? (field.optional ? "SetNull" : "Restrict");
        const sqlRule = { Restrict: "RESTRICT", Cascade: "CASCADE", SetNull: "SET NULL", NoAction: "NO ACTION" }[rule];
        expectedKeys.add(`${from.join(",")}->${field.type}:${sqlRule}`);
      }
      const actualKeys = new Set<string>();
      const foreign = db.prepare(`PRAGMA foreign_key_list("${model.name}")`).all() as { id: number; table: string; from: string; on_delete: string }[];
      const grouped = new Map<number, { table: string; from: string[]; rule: string }>();
      for (const row of foreign) {
        const entry = grouped.get(row.id) ?? { table: row.table, from: [], rule: row.on_delete };
        entry.from.push(row.from);
        grouped.set(row.id, entry);
      }
      for (const entry of grouped.values()) actualKeys.add(`${entry.from.join(",")}->${entry.table}:${entry.rule}`);
      assert.deepEqual([...actualKeys].sort(), [...expectedKeys].sort(), `${model.name}: foreign keys`);
    }
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
