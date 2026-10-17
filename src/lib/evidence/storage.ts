import "server-only";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

// Private evidence file storage.
//
// Files live under EVIDENCE_STORAGE_DIR, which must be outside the web-served `public/`
// directory. The on-disk name is a random 256-bit key, never the uploaded file name,
// so a client cannot influence the path. Every operation re-validates the key and
// confirms the resolved path is still inside the storage root.

const STORAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;

export class EvidenceStorageError extends Error {
  constructor(readonly code: "unconfigured" | "unsafeRoot" | "invalidKey" | "notFound" | "io") {
    super(`Evidence storage error: ${code}.`);
    this.name = "EvidenceStorageError";
  }
}

export type EvidenceStorage = { root: string };

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// Resolves and prepares the storage root. Relative values are resolved against the
// project root (process.cwd()), like DATABASE_URL.
export async function openEvidenceStorage(
  configured: string | undefined = process.env.EVIDENCE_STORAGE_DIR,
  projectRoot: string = process.cwd(),
): Promise<EvidenceStorage> {
  if (!configured || !configured.trim()) throw new EvidenceStorageError("unconfigured");
  const root = path.resolve(projectRoot, configured.trim());
  const publicDirectory = path.resolve(projectRoot, "public");
  if (root === publicDirectory || isInside(publicDirectory, root) || root === path.parse(root).root) {
    throw new EvidenceStorageError("unsafeRoot");
  }
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
  } catch {
    throw new EvidenceStorageError("io");
  }
  return { root };
}

export function newStorageKey(): string {
  return randomBytes(32).toString("hex");
}

export function isValidStorageKey(key: string): boolean {
  return STORAGE_KEY_PATTERN.test(key);
}

function locate(storage: EvidenceStorage, key: string): string {
  if (!isValidStorageKey(key)) throw new EvidenceStorageError("invalidKey");
  const target = path.resolve(storage.root, key.slice(0, 2), key);
  if (!isInside(storage.root, target)) throw new EvidenceStorageError("invalidKey");
  return target;
}

// Writes atomically: a temporary file is created exclusively (never overwriting), flushed,
// then renamed into place, so a crash cannot leave a half-written evidence file.
export async function writeEvidenceFile(
  storage: EvidenceStorage,
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  const target = locate(storage, key);
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new EvidenceStorageError("io");
  }
}

export async function readEvidenceFile(storage: EvidenceStorage, key: string): Promise<Buffer> {
  const target = locate(storage, key);
  try {
    // Refuse anything that is not a plain file (for example a symlink planted in the store).
    const stats = await lstat(target);
    if (!stats.isFile()) throw new EvidenceStorageError("notFound");
    return await readFile(target);
  } catch (error) {
    if (error instanceof EvidenceStorageError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new EvidenceStorageError(code === "ENOENT" ? "notFound" : "io");
  }
}

export async function deleteEvidenceFile(storage: EvidenceStorage, key: string): Promise<void> {
  const target = locate(storage, key);
  await rm(target, { force: true }).catch(() => undefined);
}
