/**
 * GET /api/slack/options?connectionId=...
 *
 * Returns the channels and people in a connected Slack workspace, for the
 * destination picker (dropdowns). Uses the workspace bot token, resolved
 * server-side and scoped to the calling user.
 *
 * 200 { channels: [{id,name}], users: [{id,name}] }
 * 400 invalid_request | 404 not_found
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSlackBotToken } from "@/lib/notifications/destinations";
import { listChannels, listMembers } from "@/lib/slack";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const connectionId = new URL(request.url).searchParams.get("connectionId") ?? "";
  if (!UUID_RE.test(connectionId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const token = await getSlackBotToken({ userId: user.id, connectionId });
  if (!token) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const [channels, users] = await Promise.all([listChannels(token), listMembers(token)]);
    return NextResponse.json({ channels, users });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[slack/options] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
