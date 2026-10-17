import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertRolePermission, type Role } from "@/lib/auth/authorization";
import { canAccessEngagement } from "@/lib/auth/resource-access";
import { assertEngagementOperation } from "@/lib/audits/service";
import {
  deleteEvidenceFile,
  EvidenceStorageError,
  newStorageKey,
  readEvidenceFile,
  writeEvidenceFile,
  type EvidenceStorage,
} from "./storage";
import { validateEvidenceFile } from "./validation";

type Actor = { id: string; role: Role };

export class EvidenceNotFoundError extends Error {
  constructor() {
    super("The evidence record is not available.");
    this.name = "EvidenceNotFoundError";
  }
}

export class DuplicateEvidenceError extends Error {
  constructor() {
    super("This exact file is already recorded for the engagement.");
    this.name = "DuplicateEvidenceError";
  }
}

export class InvalidEvidenceScopeError extends Error {
  constructor() {
    super("The control is not part of this engagement's scope, or the replaced record is not eligible.");
    this.name = "InvalidEvidenceScopeError";
  }
}

export class IndependentEvidenceReviewError extends Error {
  constructor() {
    super("Evidence must be reviewed by someone other than the person who uploaded it.");
    this.name = "IndependentEvidenceReviewError";
  }
}

export class EvidenceReviewStateError extends Error {
  constructor() {
    super("Only evidence that is pending review can be reviewed.");
    this.name = "EvidenceReviewStateError";
  }
}

export class EvidenceIntegrityError extends Error {
  constructor() {
    super("The stored evidence file does not match its recorded checksum.");
    this.name = "EvidenceIntegrityError";
  }
}

const uploadSchema = z.object({
  engagementId: z.string().min(1),
  controlId: z.string().min(1).nullable(),
  replacesId: z.string().min(1).nullable(),
});

const reviewSchema = z
  .object({
    decision: z.enum(["ACCEPTED", "REJECTED"]),
    note: z.string().trim().max(1_000),
  })
  .refine((value) => value.decision === "ACCEPTED" || value.note.length >= 5, {
    path: ["note"],
    message: "A rejection needs a reason.",
  });

// Evidence in these states can no longer support an assessment or be replaced again.
const INACTIVE_STATES = ["REJECTED", "SUPERSEDED"];

function event(actorId: string | null, action: string, entityType: string, entityId: string, outcome: string, detail: string) {
  return { actorId, action, entityType, entityId, outcome, detail };
}

async function recordDenied(db: PrismaClient, actor: Actor, action: string, entityId: string) {
  // Denied attempts are logged, but never reveal whether the record exists to the caller.
  await db.auditEvent
    .create({ data: event(actor.id, action, "EvidenceDocument", entityId, "DENIED", "Access to evidence was denied.") })
    .catch(() => undefined);
}

export async function uploadEvidence(
  db: PrismaClient,
  storage: EvidenceStorage,
  actor: Actor,
  input: { engagementId: string; controlId: string | null; replacesId: string | null; fileName: string; bytes: Uint8Array },
) {
  assertRolePermission(actor.role, "evidence:manage");
  const data = uploadSchema.parse(input);
  if (!(await canAccessEngagement(db, actor, data.engagementId))) {
    await recordDenied(db, actor, "EVIDENCE_UPLOAD_DENIED", data.engagementId);
    throw new EvidenceNotFoundError();
  }
  // Validates content, extension, size and active content before anything is stored.
  const file = validateEvidenceFile(input.fileName, input.bytes);
  await assertEngagementOperation(db, data.engagementId, "uploadEvidence");

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const storageKey = newStorageKey();
  // File first, row second: the database never points at a file that was not written.
  await writeEvidenceFile(storage, storageKey, input.bytes);
  try {
    return await db.$transaction(async (tx) => {
      await assertEngagementOperation(tx, data.engagementId, "uploadEvidence");
      if (data.controlId) {
        const inScope = await tx.auditScopeItem.findFirst({
          where: { engagementId: data.engagementId, controlId: data.controlId },
          select: { id: true },
        });
        if (!inScope) throw new InvalidEvidenceScopeError();
      }
      if (data.replacesId) {
        const replaced = await tx.evidenceDocument.findFirst({
          where: { id: data.replacesId, engagementId: data.engagementId, reviewStatus: { not: "SUPERSEDED" } },
          select: { id: true },
        });
        if (!replaced) throw new InvalidEvidenceScopeError();
      }
      const duplicate = await tx.evidenceDocument.findFirst({
        where: {
          engagementId: data.engagementId,
          sha256,
          reviewStatus: { notIn: INACTIVE_STATES },
          ...(data.replacesId ? { id: { not: data.replacesId } } : {}),
        },
        select: { id: true },
      });
      if (duplicate) throw new DuplicateEvidenceError();

      const record = await tx.evidenceDocument.create({
        data: {
          engagementId: data.engagementId,
          controlId: data.controlId,
          originalName: file.displayName,
          storageKey,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          sha256,
          uploadedById: actor.id,
          replacesId: data.replacesId,
        },
        select: { id: true },
      });
      if (data.replacesId) {
        await tx.evidenceDocument.update({
          where: { id: data.replacesId },
          data: { reviewStatus: "SUPERSEDED" },
        });
      }
      await tx.auditEvent.create({
        data: event(
          actor.id,
          "EVIDENCE_UPLOADED",
          "AuditEngagement",
          data.engagementId,
          "SUCCESS",
          `Evidence ${record.id} uploaded (${file.mimeType}, ${file.sizeBytes} bytes)${data.replacesId ? `; supersedes ${data.replacesId}` : ""}.`,
        ),
      });
      return record;
    });
  } catch (error) {
    // Keep the filesystem consistent with the database when the row was not committed.
    await deleteEvidenceFile(storage, storageKey);
    throw error;
  }
}

export async function reviewEvidence(db: PrismaClient, actor: Actor, evidenceId: string, input: unknown) {
  assertRolePermission(actor.role, "evidence:review");
  const data = reviewSchema.parse(input);
  const record = await db.evidenceDocument.findUnique({
    where: { id: evidenceId },
    select: { id: true, engagementId: true, uploadedById: true },
  });
  if (!record || !(await canAccessEngagement(db, actor, record.engagementId))) {
    await recordDenied(db, actor, "EVIDENCE_REVIEW_DENIED", evidenceId);
    throw new EvidenceNotFoundError();
  }
  if (record.uploadedById === actor.id) throw new IndependentEvidenceReviewError();

  return db.$transaction(async (tx) => {
    await assertEngagementOperation(tx, record.engagementId, "reviewEvidence");
    const changed = await tx.evidenceDocument.updateMany({
      where: { id: record.id, reviewStatus: "PENDING_REVIEW" },
      data: {
        reviewStatus: data.decision,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewNote: data.note || null,
      },
    });
    if (changed.count !== 1) throw new EvidenceReviewStateError();
    await tx.auditEvent.create({
      data: event(
        actor.id,
        "EVIDENCE_REVIEWED",
        "AuditEngagement",
        record.engagementId,
        "SUCCESS",
        `Evidence ${record.id} ${data.decision.toLowerCase()}.`,
      ),
    });
    return { id: record.id, reviewStatus: data.decision };
  });
}

// Returns the file for an authorised reader after verifying it against the recorded
// checksum. Callers must serve it as an attachment under the returned canonical MIME type.
export async function readEvidenceForDownload(
  db: PrismaClient,
  storage: EvidenceStorage,
  actor: Actor,
  evidenceId: string,
) {
  assertRolePermission(actor.role, "evidence:read");
  const record = await db.evidenceDocument.findUnique({
    where: { id: evidenceId },
    select: {
      id: true,
      engagementId: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
    },
  });
  if (!record || !(await canAccessEngagement(db, actor, record.engagementId))) {
    await recordDenied(db, actor, "EVIDENCE_DOWNLOAD_DENIED", evidenceId);
    throw new EvidenceNotFoundError();
  }
  let bytes: Buffer;
  try {
    bytes = await readEvidenceFile(storage, record.storageKey);
  } catch (error) {
    await db.auditEvent
      .create({ data: event(actor.id, "EVIDENCE_FILE_UNAVAILABLE", "EvidenceDocument", record.id, "FAILURE", "Stored file could not be read.") })
      .catch(() => undefined);
    if (error instanceof EvidenceStorageError && error.code === "notFound") throw new EvidenceNotFoundError();
    throw error;
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== record.sha256 || bytes.byteLength !== record.sizeBytes) {
    await db.auditEvent
      .create({ data: event(actor.id, "EVIDENCE_INTEGRITY_FAILED", "EvidenceDocument", record.id, "FAILURE", "Checksum mismatch on download.") })
      .catch(() => undefined);
    throw new EvidenceIntegrityError();
  }
  await db.auditEvent.create({
    data: event(actor.id, "EVIDENCE_DOWNLOADED", "EvidenceDocument", record.id, "SUCCESS", "Evidence file downloaded."),
  });
  return { bytes, fileName: record.originalName, mimeType: record.mimeType };
}
