/**
 * POST /api/images — upload a general-purpose image (e.g. an upload box's
 * reference photo) to the public "branding" bucket and return its URL.
 *
 * Unlike /api/account/logo this doesn't touch the profile — it just stores the
 * image and hands back a public URL the caller saves wherever it likes.
 *
 * Body: multipart/form-data with a "file" field (image, ≤ 5 MB).
 * 200 { url } | 400 invalid_file | 500 internal_error
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const BUCKET = "branding";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

async function ensureBucket() {
  const admin = getSupabaseAdmin();
  const { error } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
  if (error && !/exist/i.test(error.message)) {
    // eslint-disable-next-line no-console
    console.warn("[images] createBucket:", error.message);
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
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "invalid_file", reason: "size" }, { status: 400 });
  }

  try {
    await ensureBucket();
    const admin = getSupabaseAdmin();
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${user.id}/ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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
    console.error("[images] upload failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
