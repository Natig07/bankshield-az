import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_LOCALE, hasLocale, pickLocale } from "./config";
import { VERIFICATION_STATUSES } from "../lib/domain/enums";

// Read the JSON directly: get-dictionary.ts imports "server-only", which only loads
// inside the Next.js server runtime.
function load(locale: string): Record<string, unknown> {
  const file = path.join(process.cwd(), "src/i18n/dictionaries", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(leaves);
}

describe("dictionaries", () => {
  const en = load("en");
  const az = load("az");

  it("have identical key sets in Azerbaijani and English", () => {
    assert.deepEqual(keyPaths(az).sort(), keyPaths(en).sort());
  });

  it("have no empty strings", () => {
    for (const text of [...leaves(en), ...leaves(az)]) assert.ok(text.trim().length > 0);
  });

  it("preserve Azerbaijani characters", () => {
    const text = leaves(az).join(" ");
    for (const ch of ["ə", "ı", "ö", "ü", "ç", "ş", "ğ", "İ", "Ə"]) {
      assert.ok(text.includes(ch), `expected Azerbaijani text to contain ${ch}`);
    }
    // No mojibake or replacement characters from encoding mistakes.
    assert.ok(!text.includes("�"));
    assert.ok(!/Ã|Ä[±°]|Å[ŸžŒ]/.test(text));
  });

  it("translate every verification status", () => {
    const enStatuses = en.verification as Record<string, string>;
    const azStatuses = az.verification as Record<string, string>;
    for (const status of VERIFICATION_STATUSES) {
      assert.ok(enStatuses[status]);
      assert.ok(azStatuses[status]);
    }
  });
});

describe("locale selection", () => {
  it("recognises supported locales only", () => {
    assert.ok(hasLocale("az"));
    assert.ok(hasLocale("en"));
    assert.ok(!hasLocale("ru"));
    assert.ok(!hasLocale(""));
  });

  it("defaults to Azerbaijani", () => {
    assert.equal(DEFAULT_LOCALE, "az");
    assert.equal(pickLocale(null), "az");
    assert.equal(pickLocale("ru,fr;q=0.8"), "az");
  });

  it("honours Accept-Language weights", () => {
    assert.equal(pickLocale("en-US,en;q=0.9"), "en");
    assert.equal(pickLocale("az-AZ,az;q=0.9,en;q=0.8"), "az");
    assert.equal(pickLocale("en;q=0.4,az;q=0.9"), "az");
    assert.equal(pickLocale("en;q=0"), "az");
  });
});
