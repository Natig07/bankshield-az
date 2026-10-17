import type { NextRequest } from "next/server";
import { PermissionDeniedError } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/dal";
import { getPrisma } from "@/lib/db";
import {
  EvidenceIntegrityError,
  EvidenceNotFoundError,
  readEvidenceForDownload,
} from "@/lib/evidence/service";
import { EvidenceStorageError, openEvidenceStorage } from "@/lib/evidence/storage";
import { contentDispositionAttachment } from "@/lib/evidence/validation";

// Authenticated evidence download. Authorisation (role permission and engagement
// access) is enforced inside readEvidenceForDownload, never here by URL alone.
// Responses never reveal whether a record exists to someone who may not read it.
const noStore = { "Cache-Control": "private, no-store" };

function problem(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: noStore });
}

export async function GET(_request: NextRequest, context: RouteContext<"/api/evidence/[evidenceId]">) {
  const user = await getCurrentUser();
  if (!user) return problem(401, "Authentication is required.");
  const { evidenceId } = await context.params;
  try {
    const storage = await openEvidenceStorage();
    const file = await readEvidenceForDownload(getPrisma(), storage, user, evidenceId);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        ...noStore,
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": contentDispositionAttachment(file.fileName),
        // Never let the browser sniff or render stored content inline.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return problem(403, "You do not have permission to download evidence.");
    if (error instanceof EvidenceNotFoundError) return problem(404, "The evidence file is not available.");
    const name = error instanceof Error ? error.name : "UnknownError";
    const code = error instanceof EvidenceStorageError ? error.code : undefined;
    console.error("Evidence download failed.", { name, code, integrity: error instanceof EvidenceIntegrityError });
    return problem(500, "The evidence file could not be served.");
  }
}
