import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentDispositionAttachment,
  EvidenceValidationError,
  MAX_EVIDENCE_BYTES,
  sanitizeDisplayName,
  validateEvidenceFile,
} from "./validation";

const pdf = Buffer.from("%PDF-1.7\nsynthetic test document\n%%EOF");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const zipWith = (...names: string[]) =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names.join("\0"), "latin1")]);
const docx = zipWith("[Content_Types].xml", "word/document.xml");
const xlsx = zipWith("[Content_Types].xml", "xl/workbook.xml");

function reason(name: string, bytes: Uint8Array) {
  try {
    validateEvidenceFile(name, bytes);
  } catch (error) {
    assert.ok(error instanceof EvidenceValidationError);
    return error.reason;
  }
  return "accepted";
}

describe("evidence validation", () => {
  it("accepts supported synthetic files and assigns the canonical MIME type", () => {
    assert.equal(validateEvidenceFile("policy.PDF", pdf).mimeType, "application/pdf");
    assert.equal(validateEvidenceFile("screen.png", png).mimeType, "image/png");
    assert.equal(validateEvidenceFile("photo.jpeg", jpeg).mimeType, "image/jpeg");
    assert.equal(validateEvidenceFile("photo.jpg", jpeg).kind, "jpeg");
    assert.equal(validateEvidenceFile("report.docx", docx).kind, "docx");
    assert.equal(validateEvidenceFile("matrix.xlsx", xlsx).kind, "xlsx");
    assert.equal(validateEvidenceFile("notes.txt", Buffer.from("Azərbaycan dili — ümumi qeyd")).kind, "txt");
    assert.equal(validateEvidenceFile("log.csv", Buffer.from("a,b\n1,2\n")).mimeType, "text/csv");
  });

  it("rejects empty and oversized files", () => {
    assert.equal(reason("a.pdf", Buffer.alloc(0)), "empty");
    assert.equal(reason("a.pdf", Buffer.concat([pdf, Buffer.alloc(MAX_EVIDENCE_BYTES)])), "tooLarge");
    assert.equal(validateEvidenceFile("a.pdf", Buffer.concat([pdf, Buffer.alloc(MAX_EVIDENCE_BYTES - pdf.length)])).sizeBytes, MAX_EVIDENCE_BYTES);
  });

  it("rejects unsupported or missing extensions regardless of content", () => {
    assert.equal(reason("tool.exe", Buffer.from("MZ")), "unsupportedType");
    assert.equal(reason("page.html", Buffer.from("<script>")), "unsupportedType");
    assert.equal(reason("macro.docm", docx), "unsupportedType");
    assert.equal(reason("archive.zip", zipWith("a")), "unsupportedType");
    assert.equal(reason("noextension", pdf), "unsupportedType");
    assert.equal(reason(".pdf", pdf), "unsupportedType");
  });

  it("rejects content that does not match the extension", () => {
    assert.equal(reason("fake.pdf", png), "contentMismatch");
    assert.equal(reason("fake.png", pdf), "contentMismatch");
    assert.equal(reason("fake.docx", pdf), "contentMismatch");
    assert.equal(reason("fake.docx", xlsx), "contentMismatch");
    assert.equal(reason("fake.xlsx", docx), "contentMismatch");
    assert.equal(reason("fake.txt", png), "contentMismatch");
    assert.equal(reason("fake.csv", Buffer.from([0x61, 0x00, 0x62])), "contentMismatch");
    assert.equal(reason("fake.txt", Buffer.from([0xc3, 0x28])), "contentMismatch");
  });

  it("rejects office files that carry a macro project", () => {
    assert.equal(reason("renamed.docx", zipWith("[Content_Types].xml", "word/document.xml", "word/vbaProject.bin")), "activeContent");
  });

  it("never lets a client-supplied path influence the stored display name", () => {
    assert.equal(validateEvidenceFile("../../etc/passwd.pdf", pdf).displayName, "passwd.pdf");
    assert.equal(validateEvidenceFile("..\\..\\windows\\system.pdf", pdf).displayName, "system.pdf");
    assert.equal(sanitizeDisplayName("a\u0000b\r\nc.pdf"), "abc.pdf");
    assert.equal(sanitizeDisplayName("evil‮fdp.exe"), "evilfdp.exe");
    assert.equal(sanitizeDisplayName(".."), "evidence");
    assert.equal(sanitizeDisplayName(""), "evidence");
    assert.equal(sanitizeDisplayName("x".repeat(500) + ".pdf").length, 200);
  });

  it("builds a download header that cannot be split or broken by the file name", () => {
    const header = contentDispositionAttachment('bad"name;\r\nSet-Cookie: x=1 — hesabat.pdf');
    assert.ok(header.startsWith("attachment; filename=\""));
    assert.ok(!/[\r\n]/.test(header));
    assert.equal(header.split('"').length, 3);
    assert.ok(header.includes("filename*=UTF-8''"));
    assert.ok(contentDispositionAttachment("hesabat — ə.pdf").includes("%C9%99"));
  });
});
