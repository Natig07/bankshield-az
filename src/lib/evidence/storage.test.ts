import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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

const isWindows = process.platform === "win32";

// Directory links: junctions work on Windows without administrator rights or Developer
// Mode, ordinary symlinks do not. File symlinks need the privilege on Windows, so they are
// probed once and the tests that need them are reported as skipped when unavailable.
const directoryLinkType = isWindows ? "junction" : "dir";

function probeFileSymlinks(): string | false {
  const probeDirectory = mkdtempSync(path.join(tmpdir(), "bankshield-symlink-probe-"));
  try {
    writeFileSync(path.join(probeDirectory, "target"), "x");
    symlinkSync(path.join(probeDirectory, "target"), path.join(probeDirectory, "link"), "file");
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return `this platform cannot create file symlinks without extra privileges (${code ?? "unknown error"})`;
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
  }
}
const fileSymlinkSkip = probeFileSymlinks();

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)],
  );
}

// Keys are random and sharded by their first two hex characters, so a new key can land in a
// shard directory created by an earlier test. Tests that plant something at the shard path
// itself need a key whose shard does not exist yet; otherwise they fail roughly 1 time in 256
// per previously used shard.
function keyWithFreshShard(): string {
  for (;;) {
    const key = newStorageKey();
    if (!existsSync(path.join(storage.root, key.slice(0, 2)))) return key;
  }
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
    assert.ok(lstatSync(expected).isFile(), "stored evidence must be a regular file, not a link");
    assert.equal(statSync(expected).mode & 0o111, 0, "stored evidence must never be executable");
    assert.deepEqual(await readEvidenceFile(storage, key), bytes);
    assert.ok(!filesUnder(storage.root).some((file) => file.endsWith(".tmp")));
  });

  it(
    "restricts permissions to the owner (POSIX file mode 0600, directories without group/other access)",
    { skip: isWindows ? "Windows does not enforce POSIX permission bits (Node reports 0666 whatever mode is requested); access is governed by NTFS ACLs inherited from the storage directory" : false },
    async () => {
      const key = newStorageKey();
      await writeEvidenceFile(storage, key, Buffer.from("private"));
      const file = path.join(storage.root, key.slice(0, 2), key);
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(path.dirname(file)).mode & 0o077, 0, "shard directory must not be group/other accessible");
      assert.equal(statSync(storage.root).mode & 0o077, 0, "storage root must not be group/other accessible");
    },
  );

  it(
    "on Windows, stores a plain, non-executable file inside the root that is read back byte for byte",
    { skip: isWindows ? false : "Windows-only check; POSIX permission bits are asserted by the previous test" },
    async () => {
      // Windows ignores the mode passed to open()/mkdir(), so the 0600/0700 requests in the
      // implementation are best-effort there. What can be verified is the file's shape and
      // location. Real access control comes from the NTFS ACL of the storage directory.
      const key = newStorageKey();
      const bytes = Buffer.from("windows evidence bytes");
      await writeEvidenceFile(storage, key, bytes);
      const file = path.join(storage.root, key.slice(0, 2), key);
      const stats = lstatSync(file);
      assert.ok(stats.isFile() && !stats.isSymbolicLink());
      assert.equal(stats.mode & 0o111, 0);
      assert.ok(path.relative(storage.root, file).split(path.sep).length === 2);
      assert.deepEqual(readFileSync(file), bytes);
    },
  );

  it("keeps every generated key inside the private storage root", async () => {
    const root = path.resolve(storage.root);
    for (let index = 0; index < 25; index += 1) {
      const key = newStorageKey();
      await writeEvidenceFile(storage, key, Buffer.from(String(index)));
      const relative = path.relative(root, path.join(root, key.slice(0, 2), key));
      assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative), key);
    }
    const stored = filesUnder(root);
    assert.ok(stored.length >= 25);
    assert.ok(stored.every((file) => !path.relative(root, file).startsWith("..")));
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

  it("reports missing files as not found", async () => {
    assert.equal(await storageCode(readEvidenceFile(storage, newStorageKey())), "notFound");
  });

  it("refuses a file symlink planted in the store", { skip: fileSymlinkSkip }, async () => {
    const key = newStorageKey();
    const outside = path.join(base, "linked-secret.txt");
    writeFileSync(outside, "do not serve");
    mkdirSync(path.join(storage.root, key.slice(0, 2)), { recursive: true });
    symlinkSync(outside, path.join(storage.root, key.slice(0, 2), key), "file");
    assert.equal(await storageCode(readEvidenceFile(storage, key)), "notFound");
    assert.equal(readFileSync(outside, "utf8"), "do not serve");
  });

  it("refuses a shard directory that links outside the store (symlink, or junction on Windows)", async () => {
    const outsideDirectory = path.join(base, `escape-${newStorageKey().slice(0, 8)}`);
    mkdirSync(outsideDirectory);
    const key = keyWithFreshShard();
    const planted = path.join(outsideDirectory, key);
    writeFileSync(planted, "must stay private");
    const link = path.join(storage.root, key.slice(0, 2));
    symlinkSync(outsideDirectory, link, directoryLinkType);
    try {
      // Reads must not follow the link and serve the outside file.
      assert.equal(await storageCode(readEvidenceFile(storage, key)), "invalidKey");
      // Writes must not create files outside the store, and must not clean up outside it either.
      const sibling = key.slice(0, 2) + newStorageKey().slice(2);
      assert.equal(await storageCode(writeEvidenceFile(storage, sibling, Buffer.from("leak"))), "invalidKey");
      assert.deepEqual(readdirSync(outsideDirectory), [key]);
      // Deletes must not remove files outside the store.
      assert.equal(await storageCode(deleteEvidenceFile(storage, key)), "invalidKey");
      assert.equal(readFileSync(planted, "utf8"), "must stay private");
    } finally {
      // Remove only the link itself, so later tests whose random key shares this shard are unaffected.
      try {
        unlinkSync(link);
      } catch {
        rmdirSync(link); // Windows junctions are removed as directories
      }
    }
  });

  it("replaces an existing key atomically and leaves no temporary file after a failed write", async () => {
    const key = newStorageKey();
    await writeEvidenceFile(storage, key, Buffer.from("first"));
    await writeEvidenceFile(storage, key, Buffer.from("second")); // rename replaces atomically
    assert.deepEqual(await readEvidenceFile(storage, key), Buffer.from("second"));

    const blockedKey = keyWithFreshShard();
    // A regular file where the shard directory should be makes the write fail.
    const blocker = path.join(storage.root, blockedKey.slice(0, 2));
    writeFileSync(blocker, "not a directory");
    try {
      assert.equal(await storageCode(writeEvidenceFile(storage, blockedKey, Buffer.from("x"))), "io");
      assert.ok(!filesUnder(storage.root).some((file) => file.endsWith(".tmp")));
    } finally {
      rmSync(blocker, { force: true }); // otherwise later random keys in this shard cannot be written
    }
  });

  it("deletes stored files and tolerates deleting something already gone", async () => {
    const key = newStorageKey();
    await writeEvidenceFile(storage, key, Buffer.from("temporary"));
    await deleteEvidenceFile(storage, key);
    assert.equal(await storageCode(readEvidenceFile(storage, key)), "notFound");
    await deleteEvidenceFile(storage, key);
  });
});
