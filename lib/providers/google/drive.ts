/**
 * Google Drive API operations (server-only).
 *
 * Implemented:
 *   - getFolderMetadata(accessToken, folderId)  — manual folder-ID validation
 *   - initiateResumableUpload({accessToken, …})  — creates a resumable session
 *
 * Why direct-to-Drive resumable upload?
 *   Vercel functions cap at 4.5 MB request body and 300 s execution time.
 *   Multi-GB videos can't be proxied through our backend. Instead:
 *     1. Server initiates a resumable session with Google (this file).
 *     2. Google returns a one-time session URL (the Location header).
 *     3. Server hands that URL to the browser.
 *     4. Browser PUTs file chunks directly to Google.
 *   The OAuth token never leaves the server. The session URL is scoped to
 *   one file and expires quickly.
 *
 * References:
 *   https://developers.google.com/drive/api/guides/manage-uploads#resumable
 */
import "server-only";
import { coreEnv } from "@/lib/env";
import type { ResumableUploadSession } from "@/lib/providers/types";

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
// Google requires resumable chunks to be multiples of 256 KB. 8 MB balances
// throughput against the cost of re-sending a chunk after a network blip.
export const DRIVE_CHUNK_SIZE = 8 * 1024 * 1024;
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

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

  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (res.status === 403) return { ok: false, reason: "no_access" };
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
  if (data.trashed) return { ok: false, reason: "trashed" };
  if (data.mimeType !== DRIVE_FOLDER_MIME) return { ok: false, reason: "not_a_folder" };

  return {
    ok: true,
    id: data.id!,
    name: data.name ?? "(no name)",
    mimeType: data.mimeType,
    isFolder: true,
    driveId: data.driveId ?? null,
  };
}

// ---- Resumable upload ------------------------------------------------------

/**
 * Create a resumable upload session in `folderId` and return the session URL
 * (which the browser will PUT chunks to) plus the recommended chunk size.
 *
 * We send the Origin header so Google binds the session's CORS allowance to
 * our app origin — this is what lets the browser PUT chunks cross-origin to
 * the returned session URL.
 */
export async function initiateResumableUpload(args: {
  accessToken: string;
  folderId: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<ResumableUploadSession> {
  const appUrl = coreEnv().NEXT_PUBLIC_APP_URL;

  const url = `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&supportsAllDrives=true`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": args.mimeType || "application/octet-stream",
      "X-Upload-Content-Length": String(args.size),
      // Bind the resumable session's CORS allowance to our origin so the
      // browser can PUT chunks to the returned session URL.
      Origin: appUrl,
    },
    body: JSON.stringify({
      name: args.filename,
      parents: [args.folderId],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to start Drive resumable session (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const sessionUrl = res.headers.get("location");
  if (!sessionUrl) {
    throw new Error("Drive resumable session did not return a Location header.");
  }

  return { sessionUrl, chunkSize: DRIVE_CHUNK_SIZE };
}
