import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// Submit buttons use SubmitButton so every form shows a spinner and blocks a second click while its
// action runs. A raw submit button would quietly skip both.
test("forms use SubmitButton rather than a raw submit button", () => {
  const root = path.join(process.cwd(), "src");
  for (const file of walk(root).filter((f) => f.endsWith(".tsx") && !f.endsWith("submit-button.tsx"))) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/<button\s+type="submit"/.test(source), `${path.relative(root, file)} has a raw <button type="submit">; use SubmitButton`);
  }
});
