import assert from "node:assert/strict";
import test from "node:test";
import { createSessionToken, hashSessionToken, SESSION_TTL_MS } from "./session-core";

test("session tokens use 256 bits of url-safe randomness and are stored as hashes", () => {
  const token = createSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashSessionToken(token).length, 64);
  assert.notEqual(hashSessionToken(token), token);
  assert.notEqual(createSessionToken(), token);
});

test("database sessions expire after eight hours", () => {
  assert.equal(SESSION_TTL_MS, 8 * 60 * 60 * 1000);
});
