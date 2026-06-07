/**
 * POST /api/upload/unlock
 *
 * Anonymous endpoint for password-protected links. The public page withholds
 * the form (and its custom fields) until the visitor proves they know the
 * password — this verifies it server-side and, only on success, returns the
 * public link config so the client can render the form. The field definitions
 * are therefore never sent to the browser until the password is correct.
 *
 * Body: { slug, password }
 * 200 { link }                 — verified; full public config returned
 * 400 invalid_request
 * 403 invalid_password | inactive | expired
 * 404 not_found
 */
import { NextResponse, type NextRequest } from "next/server";
import { uploadUnlockSchema } from "@/lib/schemas";
import { getLinkBySlugAdmin, getPublicLinkBySlug } from "@/lib/links";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = uploadUnlockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { slug, password } = parsed.data;

  let link;
  try {
    link = await getLinkBySlugAdmin(slug);
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!link.is_active) return NextResponse.json({ error: "inactive" }, { status: 403 });
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 403 });
  }

  const required = link.upload_password?.trim();
  if (required && password.trim() !== required) {
    return NextResponse.json({ error: "invalid_password" }, { status: 403 });
  }

  // Verified — return the same public projection the page would normally use.
  const publicLink = await getPublicLinkBySlug(slug);
  if (!publicLink) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ link: publicLink });
}
