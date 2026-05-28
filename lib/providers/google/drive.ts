/**
 * Google Drive API operations (server-only).
 *
 * Implemented:
 *   - getFolderMetadata(accessToken, folderId) — used by /api/google/verify-folder
 *     for the manual folder ID fallback path.
 *
 * Coming in M7:
 *   - initiateResumableUpload — the browser-direct upload path.
 *
 * Why direct-to-Drive resumable upload?
 *   Vercel functions cap at 4.5 MB request body and 300 s execution time.
 *   Multi-GB videos can't be proxied through our backend. Instead:
 *     1. Server initiates a resumable session with Google using the user's
 *        OAuth token.
 *     2. Google returns a one-time, short-lived session URL.
 *     3. Server hands that URL to the browser.
 *     4. Browser PUTs file chunks directly to Google.
 *   The OAuth token never leaves the server. The session URL is scoped to
 *   one file and expires quickly.
 *
 * References:
 *   https://developers.google.com/drive/api/reference/rest/v3/files/get
 *   https://developers.google.com/drive/api/guides/manage-uploads#resumable
 */
import "server-only";
import { decryptString, type EncryptedBlob } from "@/lib/crypto/tokens";
import type { ResumableUploadSession } from "@/lib/providers/types";
import type { StorageConnectionRow } from "@/lib/db-types";

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_CHUNK_SIZE = 8 * 1024 * 1024;
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

// ---- Folder metadata -------------------------------------------------------

export type FolderMetadataResult =
  | {
      ok: true;
      id: string;
      name: string;
      mimeType: string;
      isFolder: boolean;
      driveId: string | null;
    }
  | {
      ok: false;
      reason: "not_found" | "no_access" | "trashed" | "not_a_folder" | "api_error";
      message?: string;
    };

interface DriveFileResponse {
  id?: string;
  name?: string;
  mimeType?: string;
  trashed?: boolean;
  driveId?: string;
  error?: { code: number; message: string };
}

/**
 * Fetch a file/folder's metadata from Drive. Used by the manual folder ID
 * fallback path to validate a pasted folder ID before persisting it on an
 * upload_links row.
 *
 * Returns `{ ok: false, reason }` for the four common failure modes (not
 * found, no access, trashed folder, not actually a folder) so the UI can
 * render a specific error message.
 */
export async function getFolderMetadata(
  accessToken: string,
  folderId: string,
): Promise<FolderMetadataResult> {
  const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}`);
  url.searchParams.set("fields", "id,name,mimeType,trashed,driveId");
  url.searchParams.set("supportsAllDrives", "true");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      reason: "api_error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.status === 404) {
    return { ok: false, reason: "not_found" };
  }
  if (res.status === 403) {
    return { ok: false, reason: "no_access" };
  }
  if (!res.ok) {
    let body: DriveFileResponse | null = null;
    try {
      body = (await res.json()) as DriveFileResponse;
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      reason: "api_error",
      message: body?.error?.message ?? `Drive returned ${res.status}`,
    };
  }

  const data = (await res.json()) as DriveFileResponse;
  if (data.trashed) {
    return { ok: false, reason: "trashed" };
  }
  if (data.mimeType !== DRIVE_FOLDER_MIME) {
    return { ok: false, reason: "not_a_folder" };
  }

  return {
    ok: true,
    id: data.id!,
    name: data.name ?? "(no name)",
    mimeType: data.mimeType,
    isFolder: true,
    driveId: data.driveId ?? null,
  };
}

// ---- Resumable upload (M7) ------------------------------------------------

/**
 * Decrypt a connection's access token. Helper used by initiateResumableUpload
 * once M7 implements it. Until then we use lib/tokens.ts's getValidAccessToken
 * directly because it handles refresh too.
 */
function decryptAccessToken(connection: StorageConnectionRow): string {
  const blob: EncryptedBlob = {
    ciphertext: connection.access_token_ciphertext,
    iv: connection.access_token_iv,
    authTag: connection.access_token_auth_tag,
  };
  return decryptString(blob);
}

export async function initiateResumableUpload(args: {
  connection: StorageConnectionRow;
  folderId: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<ResumableUploadSession> {
  void args;
  void decryptAccessToken;
  throw new Error(
    "Google Drive initiateResumableUpload not implemented yet — coming in M7.",
  );
}
