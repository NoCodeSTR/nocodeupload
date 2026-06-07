/**
 * Google Drive API operations (server-only).
 *
 * Scope: drive.file only. The app never reads the user's existing files; the
 * Picker grants per-folder access to the selected destination, and we create
 * files within it.
 *
 * Upload architecture (server-relayed resumable):
 *   The browser sends file chunks to OUR API (same-origin, no CORS), and the
 *   server relays each chunk to Google's resumable session URL (see
 *   lib/providers/resumable.ts). We do NOT have the browser PUT directly to
 *   Google because Node's fetch drops the Origin header, so Google won't attach
 *   CORS to a server-initiated session. Relaying also keeps the OAuth token and
 *   session URL server-side. Chunks are 4 MB to stay under Vercel's request limit.
 *
 * References:
 *   https://developers.google.com/drive/api/guides/manage-uploads#resumable
 */
import "server-only";
import type { ResumableUploadSession, InitiateUploadArgs } from "@/lib/providers/types";

export const DRIVE_CHUNK_SIZE = 4 * 1024 * 1024;
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/**
 * Create a Drive folder and return its id + name. Allowed under drive.file (the
 * app may create files/folders it makes — no broad scope needed). Optionally
 * nested under `parentId` (a folder the app already has access to); otherwise
 * created at the user's My Drive root.
 */
export async function createFolder(args: {
  accessToken: string;
  name: string;
  parentId?: string | null;
}): Promise<{ id: string; name: string }> {
  const body: Record<string, unknown> = {
    name: args.name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (args.parentId) body.parents = [args.parentId];

  const res = await fetch(`${DRIVE_API_BASE}/files?fields=id,name&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to create Drive folder (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string; name?: string };
  if (!data.id) throw new Error("Drive folder create returned no id.");
  return { id: data.id, name: data.name ?? args.name };
}

/**
 * Open a Drive resumable upload session and return its session URL plus the
 * chunk size the client should slice with. Uses `filename`; title/description
 * (YouTube-specific) are ignored.
 */
export async function initiateResumableUpload(
  args: InitiateUploadArgs,
): Promise<ResumableUploadSession> {
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
