import assert from "node:assert/strict";
import test from "node:test";
import { formatDate } from "./date";

test("formats dates in UTC with fixed month names for each language", () => {
  assert.equal(formatDate(new Date("2026-10-18T23:30:00Z"), "en"), "18 Oct 2026");
  assert.equal(formatDate("2026-10-18T23:30:00Z", "az"), "18 okt 2026");
  assert.equal(formatDate(Date.UTC(2027, 0, 5), "az"), "5 yan 2027");
});

test("reads the UTC calendar day regardless of the runtime timezone", () => {
  assert.equal(formatDate("2026-12-31T21:00:00Z", "en"), "31 Dec 2026");
});

test("returns an empty string for invalid input and falls back to English", () => {
  assert.equal(formatDate("not-a-date", "en"), "");
  assert.equal(formatDate("2026-03-01T00:00:00Z", "xx"), "1 Mar 2026");
});
