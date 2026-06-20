/**
 * POST /api/branding/logo — upload an image to the branding bucket and return
 * its public URL, WITHOUT touching the account profile. Used for per-link logo
 * overrides (the link form stores the returned URL on the link's
 * branding_logo_url). Mirrors /api/account/logo's storage handling.
 *
 * POST body: multipart/form-data with a "file" field (image, ≤ 2 MB).
 * 200 { url } | 400 invalid_file | 500 internal_error
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "branding";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"];

async function ensureBucket() {
  const admin = getSupabaseAdmin();
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_LOGO_BYTES,
  });
  if (error && !/exist/i.test(error.message)) {
    // eslint-disable-next-line no-console
    console.warn("[branding/logo] createBucket:", error.message);
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_file" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_file" }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "invalid_file", reason: "type" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: "invalid_file", reason: "size" }, { status: 400 });
  }

  try {
    await ensureBucket();
    const admin = getSupabaseAdmin();
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    // Scope to the user + a unique suffix so per-link logos never collide.
    const path = `${user.id}/link-logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[branding/logo] upload failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
