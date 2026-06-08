/**
 * GET /api/airtable/file/[token]
 *
 * Public, unauthenticated endpoint that streams ONE uploaded file's bytes so
 * Airtable can copy it into an attachment field. We hand Airtable a link to
 * this route (not a public Drive share), so:
 *   - the Drive file stays private (no anyone-with-link permission),
 *   - there's no share/revoke race — every file in a multi-file submission
 *     stays fetchable for the token's lifetime, so Airtable reliably grabs all.
 *
 * The token is an AES-GCM-encrypted "<uploadId>|<expiryMs>" minted server-side
 * in lib/airtable/record.ts. It is unforgeable and expires (default 30 min),
 * after which this route 410s. Scope is exactly one upload's bytes.
 *
 * 200 (streamed bytes) | 400 bad token | 410 expired | 404 unknown upload
 * 415 not a Drive file | 502 provider/stream error
 */
import { type NextRequest, NextResponse } from "next/server";
import { decryptFromToken } from "@/lib/crypto/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getValidAccessToken, TokenError } from "@/lib/tokens";
import { fetchDriveMedia } from "@/lib/providers/google/drive";

// Streaming a file through the function — give it headroom.
export const maxDuration = 60;

interface UploadFileRow {
  user_id: string;
  storage_connection_id: string;
  provider: string | null;
  provider_file_id: string | null;
  original_filename: string;
  mime_type: string | null;
}

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  // Decode + verify the signed token.
  let uploadId: string;
  let expiryMs: number;
  try {
    const [id, exp] = decryptFromToken(params.token).split("|");
    uploadId = id;
    expiryMs = Number(exp);
    if (!uploadId || !Number.isFinite(expiryMs)) throw new Error("malformed");
  } catch {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  if (Date.now() > expiryMs) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Load the upload (service role — this runs without a user session).
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select("user_id, storage_connection_id, provider, provider_file_id, original_filename, mime_type")
    .eq("id", uploadId)
    .maybeSingle();
  const upload = data as UploadFileRow | null;
  if (!upload || !upload.provider_file_id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (upload.provider !== "google_drive") {
    return NextResponse.json({ error: "unsupported_provider" }, { status: 415 });
  }

  // Owner's Drive token (refreshes if needed), then stream the bytes through.
  let accessToken: string;
  try {
    const res = await getValidAccessToken({
      userId: upload.user_id,
      connectionId: upload.storage_connection_id,
    });
    accessToken = res.accessToken;
  } catch (err) {
    if (err instanceof TokenError) {
      return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
    }
    // eslint-disable-next-line no-console
    console.error("[airtable/file] token error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  let driveRes: Response;
  try {
    driveRes = await fetchDriveMedia({ accessToken, fileId: upload.provider_file_id });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable/file] drive fetch failed:", err);
    return NextResponse.json({ error: "stream_failed" }, { status: 502 });
  }
  if (!driveRes.ok || !driveRes.body) {
    return NextResponse.json({ error: "stream_failed" }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", upload.mime_type || driveRes.headers.get("content-type") || "application/octet-stream");
  const len = driveRes.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  // Suggest a filename for the attachment download.
  const safeName = upload.original_filename.replace(/["\\\r\n]/g, "_");
  headers.set("Content-Disposition", `inline; filename="${safeName}"`);
  headers.set("Cache-Control", "private, no-store");

  return new Response(driveRes.body, { status: 200, headers });
}
