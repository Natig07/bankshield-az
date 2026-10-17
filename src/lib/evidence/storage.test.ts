import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deleteEvidenceFile,
  EvidenceStorageError,
  isValidStorageKey,
  newStorageKey,
  openEvidenceStorage,
  readEvidenceFile,
  writeEvidenceFile,
  type EvidenceStorage,
} from "./storage";

let base: string;
let storage: EvidenceStorage;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)],
  );
}

async function storageCode(action: Promise<unknown>) {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof EvidenceStorageError, String(error));
    return error.code;
  }
  return "no-error";
}

before(async () => {
  base = mkdtempSync(path.join(tmpdir(), "bankshield-storage-tests-"));
  storage = await openEvidenceStorage("private-evidence", base);
});

after(() => rmSync(base, { recursive: true, force: true }));

describe("evidence storage", () => {
  it("requires configuration and refuses web-served or filesystem-root locations", async () => {
    assert.equal(await storageCode(openEvidenceStorage(undefined, base)), "unconfigured");
    assert.equal(await storageCode(openEvidenceStorage("   ", base)), "unconfigured");
    assert.equal(await storageCode(openEvidenceStorage("public", base)), "unsafeRoot");
    assert.equal(await storageCode(openEvidenceStorage("./public/evidence", base)), "unsafeRoot");
    assert.equal(await storageCode(openEvidenceStorage("/", base)), "unsafeRoot");
    assert.equal(storage.root, path.join(base, "private-evidence"));
  });

  it("generates 256-bit opaque keys and accepts only that format", () => {
    const key = newStorageKey();
    assert.ok(isValidStorageKey(key));
    assert.notEqual(key, newStorageKey());
    for (const bad of ["", "abc", "../../etc/passwd", `${key}/..`, key.toUpperCase(), `${key.slice(0, 63)}g`, `${key}\0`, `a/${key.slice(2)}`]) {
      assert.equal(isValidStorageKey(bad), false, bad);
    }
  });

  it("writes atomically under a sharded private path and reads the exact bytes back", async () => {
    const key = newStorageKey();
    const bytes = Buffer.from("synthetic evidence bytes");
    await writeEvidenceFile(storage, key, bytes);
    const expected = path.join(storage.root, key.slice(0, 2), key);
    assert.deepEqual(filesUnder(storage.root).filter((file) => file.includes(key)), [expected]);
    assert.equal(statSync(expected).mode & 0o777, 0o600);
    assert.deepEqual(await readEvidenceFile(storage, key), bytes);
    assert.ok(!filesUnder(storage.root).some((file) => file.endsWith(".tmp")));
  });

  it("rejects traversal and malformed keys for every operation", async () => {
    const outside = path.join(base, "outside-secret.txt");
    writeFileSync(outside, "secret");
    for (const bad of ["../outside-secret.txt", "../../outside-secret.txt", "..\\outside-secret.txt", path.relative(storage.root, outside), outside]) {
      assert.equal(await storageCode(readEvidenceFile(storage, bad)), "invalidKey", bad);
      assert.equal(await storageCode(writeEvidenceFile(storage, bad, Buffer.from("x"))), "invalidKey", bad);
      assert.equal(await storageCode(deleteEvidenceFile(storage, bad)), "invalidKey", bad);
    }
    assert.equal(readdirSync(base).includes("outside-secret.txt"), true);
    assert.equal(statSync(outside).size, 6);
  });

  it("reports missing files and refuses symlinks planted in the store", async () => {
    assert.equal(await storageCode(readEvidenceFile(storage, newStorageKey())), "notFound");
    const key = newStorageKey();
    const outside = path.join(base, "linked-secret.txt");
    writeFileSync(outside, "do not serve");
    mkdirSync(path.join(storage.root, key.slice(0, 2)), { recursive: true });
    symlinkSync(outside, path.join(storage.root, key.slice(0, 2), key));
    assert.equal(await storageCode(readEvidenceFile(storage, key)), "notFound");
  });

  it("never overwrites an existing key and leaves no temporary file after a failed write", async () => {
    const key = newStorageKey();
    await writeEvidenceFile(storage, key, Buffer.from("first"));
    await writeEvidenceFile(storage, key, Buffer.from("second")); // rename replaces atomically
    assert.deepEqual(await readEvidenceFile(storage, key), Buffer.from("second"));

    const blockedKey = newStorageKey();
    // A regular file where the shard directory should be makes the write fail.
    writeFileSync(path.join(storage.root, blockedKey.slice(0, 2)), "not a directory");
    assert.equal(await storageCode(writeEvidenceFile(storage, blockedKey, Buffer.from("x"))), "io");
    assert.ok(!filesUnder(storage.root).some((file) => file.endsWith(".tmp")));
  });

  it("deletes stored files and tolerates deleting something already gone", async () => {
    const key = newStorageKey();
    await writeEvidenceFile(storage, key, Buffer.from("temporary"));
    await deleteEvidenceFile(storage, key);
    assert.equal(await storageCode(readEvidenceFile(storage, key)), "notFound");
    await deleteEvidenceFile(storage, key);
  });
});
