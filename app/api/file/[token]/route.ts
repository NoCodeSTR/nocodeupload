/**
 * GET /api/file/[token]
 *
 * Public, unauthenticated endpoint that streams ONE uploaded file's bytes for
 * the branded submission share page. The token is an AES-GCM-encrypted upload
 * id (minted in lib/submissions.ts, shareFileToken). It is unforgeable and
 * durable, but each request re-checks that the file's link still has its share
 * page enabled — so turning sharing OFF immediately kills these links too. The
 * Drive file itself stays private (we stream with the owner's token, like the
 * Airtable proxy), so this works whether or not "public files" is on.
 *
 * 200 (streamed bytes) | 400 bad token | 403 sharing off | 404 unknown upload
 * 415 not a Drive file | 502 provider/stream error
 */
import { type NextRequest, NextResponse } from "next/server";
import { decryptFromToken } from "@/lib/crypto/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getValidAccessToken, TokenError } from "@/lib/tokens";
import { fetchDriveMedia } from "@/lib/providers/google/drive";

// Streaming a file through the function — give it headroom.
export const maxDuration = 60;

interface ShareFileRow {
  user_id: string;
  storage_connection_id: string | null;
  provider: string | null;
  provider_file_id: string | null;
  original_filename: string;
  mime_type: string | null;
  source_block_id: string | null;
  upload_links: { share_page_mode: string | null } | { share_page_mode: string | null }[] | null;
}

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  let uploadId: string;
  try {
    uploadId = decryptFromToken(params.token).trim();
    if (!uploadId) throw new Error("malformed");
  } catch {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select(
      "user_id, storage_connection_id, provider, provider_file_id, original_filename, mime_type, source_block_id, upload_links(share_page_mode)",
    )
    .eq("id", uploadId)
    .maybeSingle();
  const upload = data as ShareFileRow | null;
  if (!upload || !upload.provider_file_id || upload.source_block_id === "__form") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Sharing must still be enabled on the file's link.
  const link = Array.isArray(upload.upload_links) ? upload.upload_links[0] : upload.upload_links;
  if (!link || !link.share_page_mode || link.share_page_mode === "off") {
    return NextResponse.json({ error: "sharing_off" }, { status: 403 });
  }

  if (upload.provider !== "google_drive" || !upload.storage_connection_id) {
    return NextResponse.json({ error: "unsupported_provider" }, { status: 415 });
  }

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
    console.error("[file proxy] token error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  let driveRes: Response;
  try {
    driveRes = await fetchDriveMedia({ accessToken, fileId: upload.provider_file_id });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[file proxy] drive fetch failed:", err);
    return NextResponse.json({ error: "stream_failed" }, { status: 502 });
  }
  if (!driveRes.ok || !driveRes.body) {
    return NextResponse.json({ error: "stream_failed" }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", upload.mime_type || driveRes.headers.get("content-type") || "application/octet-stream");
  const len = driveRes.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  const safeName = upload.original_filename.replace(/["\\\r\n]/g, "_");
  headers.set("Content-Disposition", `inline; filename="${safeName}"`);
  headers.set("Cache-Control", "private, no-store");

  return new Response(driveRes.body, { status: 200, headers });
}
