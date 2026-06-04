/**
 * YouTube upload (server-only) — opens a resumable videos.insert session.
 *
 * Same resumable protocol as Drive, so the shared relay (lib/providers/resumable)
 * handles the chunk PUTs and the final response (which carries the video `id`).
 * Here we only open the session with the video metadata.
 *
 * privacyStatus is "unlisted". NOTE: until the project passes the YouTube API
 * compliance audit, Google forces API-uploaded videos to PRIVATE regardless of
 * this setting — unlisted takes effect once audited.
 *
 * References:
 *   https://developers.google.com/youtube/v3/docs/videos/insert
 */
import "server-only";
import type { ResumableUploadSession, InitiateUploadArgs } from "@/lib/providers/types";

// 4 MB chunks (256 KB multiple) to stay under Vercel's request-body limit.
export const YOUTUBE_CHUNK_SIZE = 4 * 1024 * 1024;
const YOUTUBE_UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";

export async function initiateResumableUpload(
  args: InitiateUploadArgs,
): Promise<ResumableUploadSession> {
  const url = `${YOUTUBE_UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`;

  const title = (args.title || args.filename || "Upload").slice(0, 100); // YouTube title cap
  const description = (args.description || "").slice(0, 4900); // well under 5000 limit

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": args.mimeType || "video/*",
      "X-Upload-Content-Length": String(args.size),
    },
    body: JSON.stringify({
      snippet: { title, description },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to start YouTube resumable session (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const sessionUrl = res.headers.get("location");
  if (!sessionUrl) {
    throw new Error("YouTube resumable session did not return a Location header.");
  }

  return { sessionUrl, chunkSize: YOUTUBE_CHUNK_SIZE };
}
