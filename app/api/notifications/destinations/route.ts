/**
 * POST /api/notifications/destinations — create a notification destination.
 *
 * A-1 supports the "email" type (just an address). Slack destinations are
 * created via the OAuth callback in A-2, not here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { destinationCreateSchema } from "@/lib/schemas";
import { createEmailDestination } from "@/lib/notifications/destinations";

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = destinationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (parsed.data.type !== "email") {
    return NextResponse.json({ error: "unsupported_type" }, { status: 400 });
  }

  try {
    const { id } = await createEmailDestination({
      userId: user.id,
      label: parsed.data.label,
      address: parsed.data.address!,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/notifications/destinations] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
