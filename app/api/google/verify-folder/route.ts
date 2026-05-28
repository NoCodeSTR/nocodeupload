/**
 * POST /api/google/verify-folder
 *
 * Validates a manually-pasted Google Drive folder ID against the Drive API:
 *   - Folder must exist
 *   - User must have access (drive.readonly grants read for any folder the
 *     user can normally see, which is what we want)
 *   - The item must actually be a folder (not a file)
 *   - It must not be trashed
 *
 * On success, returns the folder name so the upload-link creation UI can
 * display it without forcing another API call.
 *
 * Body: { connectionId: string, folderId: string }
 * Auth: requireUser() — connection must belong to the user.
 *
 * 200 { valid: true,  folderName, folderId }
 * 200 { valid: false, reason: "not_found" | "no_access" | "trashed" | "not_a_folder" }
 * 400 { error: "invalid_request" }
 * 404 { error: string } — connection missing or revoked
 * 500 { error: string }
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getValidAccessToken, TokenError } from "@/lib/tokens";
import { getFolderMetadata } from "@/lib/providers/google/drive";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Drive folder IDs are alnum + dash + underscore. Real ones are ~28-44 chars;
// allow 20+ to leave room for any edge cases.
const FOLDER_ID_RE = /^[A-Za-z0-9_-]{20,}$/;

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let body: { connectionId?: unknown; folderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const connectionId = body.connectionId;
  const folderId = typeof body.folderId === "string" ? body.folderId.trim() : "";

  if (typeof connectionId !== "string" || !UUID_RE.test(connectionId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!FOLDER_ID_RE.test(folderId)) {
    return NextResponse.json(
      { valid: false, reason: "not_found" },
      { status: 200 },
    );
  }

  let accessToken: string;
  try {
    const result = await getValidAccessToken({
      userId: user.id,
      connectionId,
    });
    accessToken = result.accessToken;
  } catch (err) {
    if (err instanceof TokenError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const meta = await getFolderMetadata(accessToken, folderId);
  if (!meta.ok) {
    return NextResponse.json(
      { valid: false, reason: meta.reason, message: meta.message },
      { status: 200 },
    );
  }

  return NextResponse.json({
    valid: true,
    folderId: meta.id,
    folderName: meta.name,
  });
}
