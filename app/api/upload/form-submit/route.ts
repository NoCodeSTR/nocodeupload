/**
 * POST /api/upload/form-submit
 *
 * Anonymous endpoint for FORM-ONLY links (destination_type = 'form'): validates
 * the answers, records a submission (+ a file-less carrier so notifications and
 * Airtable fire through the existing pipeline), and returns.
 *
 * Body: { slug, uploaderName?, uploaderEmail?, uploaderMessage?, customValues?,
 *         prefillValues?, password? }
 * 200 { ok: true }
 * 400 invalid_request | missing_name | missing_email | missing_custom_field | not_form
 * 403 inactive | expired | invalid_password
 * 429 rate_limited
 */
import { NextResponse, type NextRequest } from "next/server";
import { uploadFormSubmitSchema } from "@/lib/schemas";
import { getLinkBySlugAdmin } from "@/lib/links";
import { createFormSubmission } from "@/lib/forms";
import { notifyAfterUpload } from "@/lib/batch";
import { recordAfterUpload } from "@/lib/airtable/record";
import { isFieldVisible } from "@/lib/conditional";
import { getAirtableRecordValues } from "@/lib/airtable/record-prefill";
import { cleanFieldValue, isValidEmail } from "@/lib/field-values";
import { prefillKey } from "@/lib/filename";
import { hashIp } from "@/lib/slug";
import { checkUploadAllowed } from "@/lib/rate-limit";

export const maxDuration = 30;

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = uploadFormSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const input = parsed.data;

  let link;
  try {
    link = await getLinkBySlugAdmin(input.slug);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[form-submit] link lookup failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (link.destination_type !== "form") {
    return NextResponse.json({ error: "not_form" }, { status: 400 });
  }
  if (!link.is_active) return NextResponse.json({ error: "inactive" }, { status: 403 });
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 403 });
  }

  // Optional password gate.
  const requiredPassword = link.upload_password?.trim();
  if (requiredPassword && (input.password ?? "").trim() !== requiredPassword) {
    return NextResponse.json({ error: "invalid_password" }, { status: 403 });
  }

  // Built-in name/email (honor hide + prefill).
  const resolvedName = link.hide_name ? (link.prefill_name ?? null) : (input.uploaderName?.trim() || null);
  const resolvedEmail = link.hide_email ? (link.prefill_email ?? null) : (input.uploaderEmail?.trim() || null);
  if (link.require_name && !link.hide_name && !resolvedName) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  if (link.require_email && !link.hide_email && !(resolvedEmail && isValidEmail(resolvedEmail))) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }

  // Resolve custom fields (same rules as the upload path, incl. conditional skip).
  const customData: Record<string, string> = {};
  const fields = Array.isArray(link.custom_fields) ? link.custom_fields : [];
  const submitted = input.customValues ?? {};
  const prefillValues = input.prefillValues ?? {};
  // Authoritative Airtable record values (server-fetched); record wins over a
  // client URL value for hidden fields, then URL prefill, then the default.
  const recordValues = await getAirtableRecordValues(link, input.recordId);
  for (const f of fields) {
    const type = f.type ?? "text";
    let val: string;
    if (f.visible) {
      if (!isFieldVisible(f.showWhen, submitted)) continue; // conditionally hidden
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

  // Rate limit (shares the upload limiter, keyed by ip + link).
  const ipHash = hashIp(clientIp(request));
  const limit = await checkUploadAllowed({ ipHash, linkId: link.id });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", reason: limit.reason },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let carrierUploadId: string;
  try {
    const res = await createFormSubmission({
      link,
      uploaderName: resolvedName,
      uploaderEmail: resolvedEmail,
      uploaderMessage: input.uploaderMessage?.trim() || null,
      customData,
      ipHash,
    });
    carrierUploadId = res.carrierUploadId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[form-submit] createFormSubmission failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Fire notifications + Airtable through the existing pipeline (best-effort).
  try {
    await notifyAfterUpload(carrierUploadId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[form-submit] notify failed:", err);
  }
  try {
    await recordAfterUpload(carrierUploadId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[form-submit] airtable record failed:", err);
  }

  return NextResponse.json({ ok: true });
}
