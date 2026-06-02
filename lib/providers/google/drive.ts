/**
 * Google Drive API operations (server-only).
 *
 * Implemented:
 *   - getFolderMetadata(accessToken, folderId)        — manual folder-ID validation
 *   - initiateResumableUpload({accessToken, …})        — opens a resumable session
 *   - putChunkToSession(sessionUrl, chunk, range)      — relays one chunk to Google
 *
 * Upload architecture (server-relayed resumable):
 *   The browser sends file chunks to OUR API (same-origin, no CORS), and the
 *   server relays each chunk to Google's resumable session URL. We do NOT have
 *   the browser PUT directly to Google because:
 *     - Node's fetch drops the Origin header, so Google won't attach CORS to a
 *       server-initiated session → the browser can't read the PUT response.
 *     - Relaying keeps both the OAuth token AND the session URL server-side.
 *   Chunks are 4 MB to stay under Vercel's 4.5 MB request-body limit; multi-GB
 *   files work as many sequential 4 MB relays.
 *
 * References:
 *   https://developers.google.com/drive/api/guides/manage-uploads#resumable
 */
import "server-only";
import type { ResumableUploadSession } from "@/lib/providers/types";

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
// 4 MB = 16 × 256 KB. Google requires non-final chunks to be 256 KB multiples,
// and Vercel caps request bodies at ~4.5 MB, so 4 MB is the sweet spot for the
// server-relayed path.
export const DRIVE_CHUNK_SIZE = 4 * 1024 * 1024;
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
 * Open a resumable upload session and return its session URL (kept server-side)
 * plus the chunk size the client should slice with.
 */
export async function initiateResumableUpload(args: {
  accessToken: string;
  folderId: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<ResumableUploadSession> {
  const url = `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&supportsAllDrives=true`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": args.mimeType || "application/octet-stream",
      "X-Upload-Content-Length": String(args.size),
    },
    body: JSON.stringify({ name: args.filename, parents: [args.folderId] }),
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

export type ChunkResult =
  | { status: "incomplete" }
  | { status: "complete"; fileId: string }
  | { status: "error"; httpStatus: number; message: string };

/**
 * Relay one chunk to a Google resumable session (server-to-server, no CORS).
 * `contentRange` is the full "bytes start-end/total" header value.
 * Returns:
 *   - incomplete  → Google accepted the chunk (HTTP 308), more expected
 *   - complete    → final chunk accepted (HTTP 200/201), file resource returned
 *   - error       → anything else
 */
export async function putChunkToSession(
  sessionUrl: string,
  chunk: ArrayBuffer | Buffer,
  contentRange: string,
): Promise<ChunkResult> {
  const body = chunk instanceof Buffer ? new Uint8Array(chunk) : new Uint8Array(chunk);
  const res = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Range": contentRange,
      "Content-Type": "application/octet-stream",
    },
    body,
    cache: "no-store",
  });

  // Google returns 308 (Resume Incomplete) between chunks.
  if (res.status === 308) {
    return { status: "incomplete" };
  }
  if (res.status === 200 || res.status === 201) {
    let fileId = "";
    try {
      const json = (await res.json()) as { id?: string };
      fileId = json.id ?? "";
    } catch {
      /* no body */
    }
    if (!fileId) {
      return { status: "error", httpStatus: res.status, message: "No file id in Drive response" };
    }
    return { status: "complete", fileId };
  }

  const text = await res.text().catch(() => "");
  return { status: "error", httpStatus: res.status, message: text.slice(0, 300) };
}
