// Evidence upload validation. Pure functions, no I/O.
//
// The type of a file is decided from its content (magic bytes), never from the
// client-supplied MIME type, and must agree with the file extension. Files are stored
// and served under the canonical MIME type chosen here.

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export type EvidenceKind = "pdf" | "png" | "jpeg" | "docx" | "xlsx" | "txt" | "csv";

const KINDS: Record<EvidenceKind, { mime: string; extensions: readonly string[] }> = {
  pdf: { mime: "application/pdf", extensions: ["pdf"] },
  png: { mime: "image/png", extensions: ["png"] },
  jpeg: { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
  },
  txt: { mime: "text/plain", extensions: ["txt"] },
  csv: { mime: "text/csv", extensions: ["csv"] },
};

export type EvidenceRejection =
  | "empty"
  | "tooLarge"
  | "unsupportedType"
  | "contentMismatch"
  | "activeContent";

export class EvidenceValidationError extends Error {
  constructor(readonly reason: EvidenceRejection) {
    super(`Evidence file rejected: ${reason}.`);
    this.name = "EvidenceValidationError";
  }
}

export type ValidatedEvidence = {
  kind: EvidenceKind;
  mimeType: string;
  displayName: string;
  sizeBytes: number;
};

// Display name only. It is never used to build a filesystem path.
export function sanitizeDisplayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 200);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "evidence";
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1).toLowerCase();
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.length <= bytes.length && signature.every((value, index) => bytes[index] === value);
}

function containsAscii(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(text, 0, "latin1");
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function detectKind(bytes: Uint8Array): EvidenceKind | "zip" | "text" | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (isUtf8Text(bytes)) return "text";
  return null;
}

export function validateEvidenceFile(name: string, bytes: Uint8Array): ValidatedEvidence {
  if (bytes.byteLength === 0) throw new EvidenceValidationError("empty");
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) throw new EvidenceValidationError("tooLarge");

  const displayName = sanitizeDisplayName(name);
  const extension = extensionOf(displayName);
  const entry = (Object.entries(KINDS) as [EvidenceKind, (typeof KINDS)[EvidenceKind]][]).find(
    ([, definition]) => definition.extensions.includes(extension),
  );
  if (!entry) throw new EvidenceValidationError("unsupportedType");
  const [expected, definition] = entry;

  const detected = detectKind(bytes);
  if (expected === "docx" || expected === "xlsx") {
    if (detected !== "zip") throw new EvidenceValidationError("contentMismatch");
    const marker = expected === "docx" ? "word/" : "xl/";
    if (!containsAscii(bytes, "[Content_Types].xml") || !containsAscii(bytes, marker)) {
      throw new EvidenceValidationError("contentMismatch");
    }
    // Macro containers belong in .docm/.xlsm, which are not accepted. A renamed one is refused.
    if (containsAscii(bytes, "vbaProject.bin")) throw new EvidenceValidationError("activeContent");
  } else if (expected === "txt" || expected === "csv") {
    if (detected !== "text") throw new EvidenceValidationError("contentMismatch");
  } else if (detected !== expected) {
    throw new EvidenceValidationError("contentMismatch");
  }

  return { kind: expected, mimeType: definition.mime, displayName, sizeBytes: bytes.byteLength };
}

// RFC 6266 / 5987 header value: ASCII fallback plus UTF-8 filename*.
export function contentDispositionAttachment(displayName: string): string {
  const fallback = displayName.replace(/[^\x20-\x7e]/g, "_").replace(/["\;]/g, "_") || "evidence";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(displayName)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
