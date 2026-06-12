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
import { mimeAllowed, fileCategory } from "@/lib/upload-validation";
import { renderFilename, renderText, splitExt, prefillKey } from "@/lib/filename";
import { isFieldVisible } from "@/lib/conditional";
import { getAirtableRecordValues, getAirtableSourceValuesForSubmit } from "@/lib/airtable/record-prefill";
import { resolveSourceRecordIds } from "@/lib/airtable/sources";
import { renderMergeTags } from "@/lib/merge-tags";
import { hashIp } from "@/lib/slug";
import { encryptToToken } from "@/lib/crypto/tokens";
import { checkUploadAllowed } from "@/lib/rate-limit";

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Normalize/validate a custom-field value by type (shared by visible + hidden). */
function cleanFieldValue(type: string, raw: string, options: string[]): string {
  switch (type) {
    case "select":
      return raw && options.includes(raw) ? raw : "";
    case "multiselect":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && options.includes(s))
        .join(", ");
    case "checkbox":
      return raw === "Yes" ? "Yes" : "";
    case "number":
    case "currency":
      return raw.replace(/[^0-9.\-]/g, "");
    case "email":
      return isValidEmail(raw) ? raw : "";
    default:
      return raw; // text, phone
  }
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
  // Form-only links accept no files — they post to /api/upload/form-submit.
  if (link.destination_type === "form") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Resolve the destination. Multi-box links pick per box (each box has its own
  // connection + folder); single links use the link's connection + folder.
  let resolvedConnectionId: string;
  let resolvedFolderId: string | null;
  let resolvedSourceBlockId: string | null = null;
  if (link.destination_type === "multi") {
    const boxes = Array.isArray(link.upload_boxes) ? link.upload_boxes : [];
    const box = input.boxId ? boxes.find((b) => b.id === input.boxId) : undefined;
    if (!box || !box.connectionId) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    if (box.destinationType === "drive" && !box.folderId) {
      return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
    }
    resolvedConnectionId = box.connectionId;
    resolvedFolderId = box.folderId ?? null;
    resolvedSourceBlockId = box.id;
  } else {
    if (!link.storage_connection_id || !link.folder_id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    resolvedConnectionId = link.storage_connection_id;
    resolvedFolderId = link.folder_id;
  }

  // Optional password gate — the owner-set value must match exactly.
  const requiredPassword = link.upload_password?.trim();
  if (requiredPassword) {
    if ((input.password ?? "").trim() !== requiredPassword) {
      return NextResponse.json({ error: "invalid_password" }, { status: 403 });
    }
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

  // Custom-field + prefill resolution inputs.
  const fields = Array.isArray(link.custom_fields) ? link.custom_fields : [];
  const submitted = input.customValues ?? {};
  const prefillValues = input.prefillValues ?? {};
  // Airtable single-record personalization (authoritative, server-fetched). For
  // hidden fields the record value wins over a client-sent URL value so an
  // uploader can't tamper with owner data; falls back to URL prefill, then default.
  const recordValues = await getAirtableRecordValues(link, input.recordId);
  // Record-source ids (e.g. ?cleaner=recXXX) → persisted so the Airtable record
  // builder can link them / copy their values into the destination row.
  const sourceRecordIds = resolveSourceRecordIds(link.airtable_config?.recordSources, prefillValues);

  // Resolve built-in name/email honoring prefill + hide. Hidden fields take the
  // owner's prefilled value server-side; the browser value is ignored. Prefill
  // values may be dynamic (e.g. {{guest.First Name}}) — resolve tokens against the
  // single record, connected sources (fetched only when a hidden token needs it),
  // and URL params.
  // Source values are needed when a hidden prefill OR the file-name / video
  // templates reference a connected record ({{alias.Field}}). Fetched once.
  const needsSourceVals =
    (link.hide_name && (link.prefill_name ?? "").includes("{{")) ||
    (link.hide_email && (link.prefill_email ?? "").includes("{{")) ||
    (link.filename_template ?? "").includes("{{") ||
    (link.description_template ?? "").includes("{{");
  const sourceVals = needsSourceVals ? await getAirtableSourceValuesForSubmit(link, prefillValues) : {};
  const prefillCtx = { ...recordValues, ...sourceVals, ...prefillValues };
  const renderPrefill = (tpl: string | null | undefined): string | null =>
    tpl ? renderMergeTags(tpl, prefillCtx).trim() || null : null;
  const resolvedName = link.hide_name
    ? renderPrefill(link.prefill_name)
    : (input.uploaderName?.trim() || null);
  const resolvedEmail = link.hide_email
    ? renderPrefill(link.prefill_email)
    : (input.uploaderEmail?.trim() || null);

  // Required built-in validation (only enforced for visible fields).
  if (link.require_name && !link.hide_name && !resolvedName) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  if (link.require_email && !link.hide_email && !(resolvedEmail && isValidEmail(resolvedEmail))) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }

  // Resolve custom fields → custom_data. Visible values come from the browser
  // (already seeded from URL prefills by the client). Hidden values come from a
  // URL prefill / the single record when present, otherwise the owner's default.
  const customData: Record<string, string> = {};
  for (const f of fields) {
    const type = f.type ?? "text";
    let val: string;
    if (f.visible) {
      // Conditionally-hidden fields weren't shown — don't require or store them.
      if (!isFieldVisible(f.showWhen, submitted)) continue;
      const raw = String(submitted[f.id] ?? f.value ?? "").trim();
      val = cleanFieldValue(type, raw, f.options ?? []);
      if (f.required && !val) {
        return NextResponse.json({ error: "missing_custom_field", label: f.label }, { status: 400 });
      }
    } else {
      const key = prefillKey(f.label);
      const recRaw = recordValues[key];
      const urlRaw = prefillValues[key];
      const raw =
        recRaw && recRaw.trim()
          ? recRaw
          : urlRaw != null && String(urlRaw).trim() !== ""
            ? String(urlRaw)
            : "";
      val = raw ? cleanFieldValue(type, raw.trim(), f.options ?? []) : String(f.value ?? "");
    }
    if (val) customData[f.label] = val;
  }

  // Two-pass templating: resolve connected-record {{alias.Field}} (and other
  // {{merge}}) tags first, so file names / video templates can use connected
  // data; the remaining {date}/{field:Label}/{name} tokens are then applied by
  // renderFilename/renderText. Mirrors the builder's preview.
  const templateMergeMap: Record<string, string> = {
    ...recordValues,
    ...sourceVals,
    ...customData,
    name: resolvedName ?? "",
    email: resolvedEmail ?? "",
    message: input.uploaderMessage?.trim() ?? "",
  };
  const filenameTpl = renderMergeTags(link.filename_template ?? "", templateMergeMap);
  const descriptionTpl = renderMergeTags(link.description_template ?? "", templateMergeMap);

  // Apply the link's filename template (no-op if unset → original name kept).
  const finalFilename = renderFilename(filenameTpl, {
    originalFilename: input.filename,
    uploaderName: resolvedName,
    uploaderEmail: resolvedEmail,
    customData,
    date: new Date(),
  });

  // Rate limit BEFORE spending a Drive session (cheaper to reject early).
  const ipHash = hashIp(clientIp(request));
  const limit = await checkUploadAllowed({ ipHash, linkId: link.id });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", reason: limit.reason },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // Fresh access token for the owner's connection (refreshes if needed).
  let accessToken: string;
  let providerId;
  try {
    const result = await getValidAccessToken({
      userId: link.user_id,
      connectionId: resolvedConnectionId,
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

  // Provider-specific prep. For YouTube: enforce video-only and build a
  // readable title + templated description.
  const { base: originalBase } = splitExt(input.filename);
  let videoTitle: string | undefined;
  let videoDescription: string | undefined;
  if (providerId === "youtube") {
    if (fileCategory(input.mimeType) !== "video") {
      return NextResponse.json({ error: "type_not_allowed" }, { status: 415 });
    }
    const ctx = {
      originalFilename: input.filename,
      uploaderName: resolvedName,
      uploaderEmail: resolvedEmail,
      uploaderMessage: input.uploaderMessage?.trim() || null,
      customData,
      date: new Date(),
    };
    videoTitle = renderText(filenameTpl, ctx) || originalBase;
    videoDescription = renderText(descriptionTpl, ctx);
  }

  // The name stored/shown for this upload: video title for YouTube, else the
  // (templated) Drive filename.
  const displayName = providerId === "youtube" ? (videoTitle ?? originalBase) : finalFilename;

  // Create the resumable session via the provider adapter.
  let session;
  try {
    const adapter = await getAdapter(providerId);
    session = await adapter.storage.initiateResumableUpload({
      accessToken,
      folderId: resolvedFolderId ?? "",
      filename: finalFilename,
      mimeType: input.mimeType,
      size: input.size,
      title: videoTitle,
      description: videoDescription,
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
      filename: displayName,
      mimeType: input.mimeType,
      size: input.size,
      uploaderName: resolvedName,
      uploaderEmail: resolvedEmail,
      uploaderMessage: input.uploaderMessage ?? null,
      customData,
      provider: providerId,
      ipHash,
      batchId: input.batchId ?? null,
      batchSize: input.batchSize ?? null,
      storageConnectionId: resolvedConnectionId,
      folderId: resolvedFolderId,
      sourceBlockId: resolvedSourceBlockId,
      airtableRecordId: input.recordId ?? null,
      sourceRecordIds,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload/initiate] createUploadRecord failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Hand the browser an OPAQUE, encrypted handle for the session — never the
  // raw Google session URL. The browser echoes it back with each chunk; the
  // chunk route decrypts it server-side and relays the bytes to Google.
  const sessionToken = encryptToToken(session.sessionUrl);

  return NextResponse.json({
    uploadId,
    sessionToken,
    chunkSize: session.chunkSize,
    totalSize: input.size,
  });
}
