/**
 * Provider-agnostic resumable-upload relay.
 *
 * Both Google Drive (files.create) and YouTube (videos.insert) use the same
 * resumable protocol: the server opens a session and gets a session URL, then
 * chunks are PUT to that URL with Content-Range headers. Google returns 308
 * between chunks and 200/201 with the created resource (which has an `id`) on
 * the final chunk. So one relay function serves every Google resumable target.
 */
import "server-only";

export type ChunkResult =
  | { status: "incomplete" }
  | { status: "complete"; fileId: string }
  | { status: "error"; httpStatus: number; message: string };

/**
 * Relay one chunk to a resumable session (server-to-server, no CORS).
 * `contentRange` is the full "bytes start-end/total" header value.
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

  if (res.status === 308) return { status: "incomplete" };

  if (res.status === 200 || res.status === 201) {
    let fileId = "";
    try {
      const json = (await res.json()) as { id?: string };
      fileId = json.id ?? "";
    } catch {
      /* no body */
    }
    if (!fileId) {
      return { status: "error", httpStatus: res.status, message: "No id in provider response" };
    }
    return { status: "complete", fileId };
  }

  const text = await res.text().catch(() => "");
  return { status: "error", httpStatus: res.status, message: text.slice(0, 300) };
}
