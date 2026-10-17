import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MAX_EVIDENCE_BYTES } from "./validation";

// Regression: a file larger than the Server Action body limit is refused by Next.js itself and
// the user sees a generic full-page error instead of the app's "file too large" message. The
// framework limit must stay above the largest accepted file plus multipart framing, so every
// file the validator accepts can reach it, and larger files are stopped by the form first.
test("Server Action body limit leaves room for the largest accepted evidence file", () => {
  const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  const match = /bodySizeLimit:\s*"(\d+)mb"/.exec(config);
  assert.ok(match, "next.config.ts must set experimental.serverActions.bodySizeLimit in mb");
  const limitBytes = Number(match[1]) * 1024 * 1024;
  assert.ok(limitBytes >= MAX_EVIDENCE_BYTES + 512 * 1024, `limit ${limitBytes} must exceed ${MAX_EVIDENCE_BYTES} plus framing`);
});

test("the upload form checks the file size in the browser before submitting", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "app", "[lang]", "(app)", "evidence", "evidence-workspace.tsx"),
    "utf8",
  );
  assert.match(source, /MAX_EVIDENCE_BYTES/);
  assert.match(source, /setCustomValidity\(/);
});
