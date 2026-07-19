/**
 * POST   /api/account/accent  — set the account's default accent color
 * DELETE /api/account/accent  — clear it
 *
 * Saved to profiles.default_accent_color as a #rrggbb hex string. Seeds the
 * brand color on every NEW upload link the user creates (each link can still
 * override it).
 *
 * POST body: { color: "#rrggbb" }
 * 200 { color } | 400 invalid_color | 500 internal_error
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Server-side hex validation (mirrors normalizeHexColor on the client). */
function normalizeHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let v = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    v = v
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toLowerCase()}` : null;
}

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let body: { color?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_color" }, { status: 400 });
  }

  const color = normalizeHex(body.color);
  if (!color) {
    return NextResponse.json({ error: "invalid_color" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("profiles")
      .update({ default_accent_color: color } as never)
      .eq("id", user.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ color });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[account/accent] save failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await requireUser();
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("profiles")
      .update({ default_accent_color: null } as never)
      .eq("id", user.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[account/accent] clear failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
