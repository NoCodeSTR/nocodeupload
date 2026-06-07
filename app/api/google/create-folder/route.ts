/**
 * POST /api/google/create-folder
 *
 * Create a new Drive folder in the owner's account (under drive.file — no new
 * scope) and return its id + name so the link form can select it. Used by the
 * "New folder" control in the folder picker.
 *
 * Body: { connectionId, name, parentId? }
 * 201 { id, name }
 * 400 invalid_request | not_supported (YouTube has no folders)
 * 502 provider_unavailable | create_failed
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getValidAccessToken, TokenError } from "@/lib/tokens";
import { createFolder } from "@/lib/providers/google/drive";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { connectionId, name, parentId } = (body ?? {}) as {
    connectionId?: unknown;
    name?: unknown;
    parentId?: unknown;
  };
  if (typeof connectionId !== "string" || !UUID_RE.test(connectionId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const folderName = typeof name === "string" ? name.trim() : "";
  if (!folderName || folderName.length > 100) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parent = typeof parentId === "string" && parentId ? parentId : null;

  let accessToken: string;
  let provider: string;
  try {
    const result = await getValidAccessToken({ userId: user.id, connectionId });
    accessToken = result.accessToken;
    provider = result.connection.provider;
  } catch (err) {
    if (err instanceof TokenError) {
      return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
    }
    // eslint-disable-next-line no-console
    console.error("[create-folder] token error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (provider === "youtube") {
    return NextResponse.json({ error: "not_supported" }, { status: 400 });
  }

  try {
    const folder = await createFolder({ accessToken, name: folderName, parentId: parent });
    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[create-folder] failed:", err);
    return NextResponse.json({ error: "create_failed" }, { status: 502 });
  }
}
