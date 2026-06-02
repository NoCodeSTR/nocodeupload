/**
 * POST /api/upload/chunk
 *
 * Same-origin chunk relay (no CORS). The browser POSTs one file chunk as the
 * raw request body; this route decrypts the opaque session handle and PUTs the
 * chunk to Google's resumable session server-side. On the final chunk it marks
 * the upload complete.
 *
 * Headers (set by the browser):
 *   x-nc-upload-id   the uploads row id
 *   x-nc-session     the opaque session token from /api/upload/initiate
 *   x-nc-range       full Content-Range value: "bytes start-end/total"
 * Body: the raw chunk bytes (≤ 4 MB, under Vercel's request-body limit).
 *
 * 200 { status: "incomplete" }            chunk accepted, more expected
 * 200 { status: "complete", fileId }      final chunk accepted, file in Drive
 * 400 { error: "invalid_request" }
 * 502 { error: "provider_error", detail } Google rejected the chunk
 * 500 { error: "internal_error" }
 */
import { NextResponse, type NextRequest } from "next/server";
import { decryptFromToken } from "@/lib/crypto/tokens";
import { putChunkToSession } from "@/lib/providers/google/drive";
import { finalizeUpload } from "@/lib/uploads";

// Each chunk relay receives ≤4 MB and forwards it to Google. Give it headroom.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGE_RE = /^bytes \d+-\d+\/\d+$/;

export async function POST(request: NextRequest) {
  const uploadId = request.headers.get("x-nc-upload-id") ?? "";
  const sessionToken = request.headers.get("x-nc-session") ?? "";
  const contentRange = request.headers.get("x-nc-range") ?? "";

  if (!UUID_RE.test(uploadId) || !sessionToken || !RANGE_RE.test(contentRange)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Decrypt the opaque session handle back to the real Google session URL.
  let sessionUrl: string;
  try {
    sessionUrl = decryptFromToken(sessionToken);
    if (!sessionUrl.startsWith("https://")) throw new Error("bad session url");
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Read the raw chunk bytes.
  let chunk: ArrayBuffer;
  try {
    chunk = await request.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (chunk.byteLength === 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Relay to Google.
  let result;
  try {
    result = await putChunkToSession(sessionUrl, chunk, contentRange);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload/chunk] relay failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (result.status === "incomplete") {
    return NextResponse.json({ status: "incomplete" });
  }

  if (result.status === "complete") {
    // Mark the upload row complete (best-effort; the file is already in Drive).
    try {
      await finalizeUpload({ uploadId, providerFileId: result.fileId });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[upload/chunk] finalize failed (file is in Drive):", err);
    }
    return NextResponse.json({ status: "complete", fileId: result.fileId });
  }

  // Google rejected the chunk.
  // eslint-disable-next-line no-console
  console.error("[upload/chunk] Drive error:", result.httpStatus, result.message);
  try {
    await finalizeUpload({ uploadId, errorMessage: `Drive ${result.httpStatus}: ${result.message}` });
  } catch {
    /* ignore */
  }
  return NextResponse.json({ error: "provider_error", detail: result.message }, { status: 502 });
}
