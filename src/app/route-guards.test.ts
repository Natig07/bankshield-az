import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const APP = path.join(process.cwd(), "src/app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const files = walk(APP).map((file) => path.relative(APP, file).split(path.sep).join("/"));

// Server Actions are public POST endpoints: hidden buttons are not access control.
// Every exported action in a feature module must reach a permission check before doing
// any work, either directly or through the file's shared run helper.
test("every exported Server Action is guarded by a permission check", () => {
  // Login/logout are intentionally unauthenticated or session-only.
  const actionFiles = files.filter(
    (file) => file.endsWith("/actions.ts") && !file.endsWith("login/actions.ts") && file !== "[lang]/actions.ts",
  );
  assert.ok(actionFiles.length >= 7, "expected the feature action modules to be found");
  for (const file of actionFiles) {
    const source = readFileSync(path.join(APP, file), "utf8");
    const parts = source.split(/\nexport async function /).slice(1);
    assert.ok(parts.length > 0, `${file} exports no actions`);
    const helperGuarded = /async function (run|runAction)\([\s\S]*?\n\}/.exec(source)?.[0].includes("requirePermission(") ?? false;
    for (const body of parts) {
      const name = body.slice(0, body.indexOf("("));
      const direct = /await (requirePermission|requireEngagementPermission)\(/.test(body);
      const viaHelper = helperGuarded && /\breturn (run|runAction)\(/.test(body);
      assert.ok(direct || viaHelper, `${file}: ${name} has no permission check`);
    }
  }
});

// A loading.tsx boundary streams the response, so notFound() after it still answers
// HTTP 200. Detail pages that call notFound() must not sit under one, otherwise a missing
// or forbidden record is reported as a success.
test("pages that call notFound() are not under a loading.tsx boundary", () => {
  const loaders = new Set(files.filter((file) => file.endsWith("/loading.tsx")).map((file) => path.posix.dirname(file)));
  for (const file of files.filter((f) => f.endsWith("/page.tsx"))) {
    if (!readFileSync(path.join(APP, file), "utf8").includes("notFound()")) continue;
    let dir = path.posix.dirname(file);
    for (;;) {
      assert.ok(!loaders.has(dir), `${file} is under ${dir}/loading.tsx; a missing record would return HTTP 200`);
      if (dir === "." || dir === "") break;
      dir = path.posix.dirname(dir);
    }
  }
});
