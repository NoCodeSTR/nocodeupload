/**
 * POST   /api/account/logo  — upload/replace the account company logo
 * DELETE /api/account/logo  — remove it
 *
 * The logo is stored in a public Supabase Storage bucket ("branding", created
 * at runtime) and its public URL saved to profiles.logo_url. Used on public
 * upload pages and in notification emails.
 *
 * POST body: multipart/form-data with a "file" field (image, ≤ 2 MB).
 * 200 { logoUrl }
 * 400 invalid_file
 * 500 internal_error
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "branding";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"];

async function ensureBucket() {
  const admin = getSupabaseAdmin();
  // Idempotent: createBucket errors if it exists; we ignore that.
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_LOGO_BYTES,
  });
  if (error && !/exist/i.test(error.message)) {
    // eslint-disable-next-line no-console
    console.warn("[account/logo] createBucket:", error.message);
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
    const path = `${user.id}/logo-${Date.now()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
    const logoUrl = data.publicUrl;

    const { error: updErr } = await admin
      .from("profiles")
      .update({ logo_url: logoUrl } as never)
      .eq("id", user.id);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({ logoUrl });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[account/logo] upload failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await requireUser();
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("profiles")
      .update({ logo_url: null } as never)
      .eq("id", user.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[account/logo] delete failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
