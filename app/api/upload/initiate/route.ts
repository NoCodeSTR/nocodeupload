/**
 * POST /api/upload/initiate
 *
 * Anonymous endpoint. Validates the upload against the link's rules, creates a
 * Google Drive resumable session (server-side, with the owner's token), logs
 * an 'uploading' row, and returns the session URL for the browser to PUT
 * chunks to directly.
 *
 * Body: { slug, filename, size, mimeType, uploaderName?, uploaderEmail?, uploaderMessage? }
 *
 * 200 { uploadId, sessionUrl, chunkSize }
 * 400 invalid_request | missing_name | missing_email
 * 403 inactive | expired
 * 404 not_found
 * 413 too_large
 * 415 type_not_allowed
 * 502 provider_unavailable   (owner's connection needs reconnecting)
 * 500 internal_error
 */
import { NextResponse, type NextRequest } from "next/server";
import { uploadInitiateSchema } from "@/lib/schemas";
import { getLinkBySlugAdmin } from "@/lib/links";
import { createUploadRecord } from "@/lib/uploads";
import { getValidAccessToken, TokenError } from "@/lib/tokens";
import { getAdapter } from "@/lib/providers/registry";
import { mimeAllowed } from "@/lib/upload-validation";
import { hashIp } from "@/lib/slug";

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = uploadInitiateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const input = parsed.data;

  // Load the full link row (service-role; the public view hides folder_id).
  let link;
  try {
    link = await getLinkBySlugAdmin(input.slug);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload/initiate] link lookup failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!link) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Link-state checks.
  if (!link.is_active) {
    return NextResponse.json({ error: "inactive" }, { status: 403 });
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 403 });
  }

  // Size + type checks.
  const maxBytes = link.max_file_size_mb * 1024 * 1024;
  if (input.size > maxBytes) {
    return NextResponse.json({ error: "too_large", maxBytes }, { status: 413 });
  }
  if (input.size <= 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!mimeAllowed(input.mimeType, link.allowed_mime_types)) {
    return NextResponse.json({ error: "type_not_allowed" }, { status: 415 });
  }

  // Required uploader fields.
  if (link.require_name && !(input.uploaderName && input.uploaderName.trim())) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  if (link.require_email && !(input.uploaderEmail && isValidEmail(input.uploaderEmail))) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }

  // Fresh access token for the owner's connection (refreshes if needed).
  let accessToken: string;
  let providerId;
  try {
    const result = await getValidAccessToken({
      userId: link.user_id,
      connectionId: link.storage_connection_id,
    });
    accessToken = result.accessToken;
    providerId = result.connection.provider;
  } catch (err) {
    if (err instanceof TokenError) {
      // Owner's connection is revoked/errored — they must reconnect.
      return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
    }
    // eslint-disable-next-line no-console
    console.error("[upload/initiate] token error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Create the resumable session via the provider adapter.
  let session;
  try {
    const adapter = await getAdapter(providerId);
    session = await adapter.storage.initiateResumableUpload({
      accessToken,
      folderId: link.folder_id,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload/initiate] session creation failed:", err);
    return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
  }

  // Log the upload row (status uploading).
  let uploadId: string;
  try {
    uploadId = await createUploadRecord({
      link,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      uploaderName: input.uploaderName ?? null,
      uploaderEmail: input.uploaderEmail ?? null,
      uploaderMessage: input.uploaderMessage ?? null,
      ipHash: hashIp(clientIp(request)),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload/initiate] createUploadRecord failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({
    uploadId,
    sessionUrl: session.sessionUrl,
    chunkSize: session.chunkSize,
  });
}
