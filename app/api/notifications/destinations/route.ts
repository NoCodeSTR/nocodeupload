/**
 * POST /api/notifications/destinations — create a notification destination.
 *
 * A-1 supports the "email" type (just an address). Slack destinations are
 * created via the OAuth callback in A-2, not here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { destinationCreateSchema } from "@/lib/schemas";
import { createEmailDestination, createQuoDestination } from "@/lib/notifications/destinations";

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
  // Slack is created via the OAuth callback, not this endpoint.
  if (parsed.data.type === "slack") {
    return NextResponse.json({ error: "unsupported_type" }, { status: 400 });
  }

  try {
    if (parsed.data.type === "quo") {
      const { id } = await createQuoDestination({
        userId: user.id,
        label: parsed.data.label,
        apiKey: parsed.data.apiKey!,
        from: parsed.data.fromNumber!,
        to: parsed.data.toNumber!,
      });
      return NextResponse.json({ id }, { status: 201 });
    }
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
