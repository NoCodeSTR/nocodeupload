/**
 * POST /api/google/picker-token
 *
 * Mints a short-lived Google access token for a specific connection. Used
 * by the in-browser Google Picker — the picker SDK requires an OAuth token
 * to render the file/folder browser.
 *
 * This is the ONLY path that exposes a Google access token to the browser.
 * The token is:
 *   - already short-lived (Google tokens expire in ~1 hour)
 *   - scoped to the user's existing OAuth grant (drive.file only)
 *   - bound to ONE picker session — even if leaked, it only grants drive.file
 *     access (files the app created / the user picks), never read-all
 *
 * The refresh token NEVER leaves the server.
 *
 * Body: { connectionId: string }
 * Auth: requireUser() — and connection must belong to the user.
 *
 * 200: { accessToken, expiresAt }
 * 400: { error: "invalid_request" } — bad/missing connectionId
 * 404: { error: string }            — connection missing or revoked
 * 500: { error: string }            — refresh failed or DB issue
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getValidAccessToken, TokenError } from "@/lib/tokens";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let body: { connectionId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const connectionId = body.connectionId;
  if (typeof connectionId !== "string" || !UUID_RE.test(connectionId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const { accessToken, expiresAt } = await getValidAccessToken({
      userId: user.id,
      connectionId,
    });
    return NextResponse.json({
      accessToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof TokenError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "not_active"
            ? 404
            : 500;
      return NextResponse.json({ error: err.message }, { status });
    }
    // eslint-disable-next-line no-console
    console.error("[picker-token] unexpected error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
