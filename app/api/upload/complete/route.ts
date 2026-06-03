/**
 * POST /api/upload/complete
 *
 * Anonymous endpoint. Called by the browser after the direct-to-Drive upload
 * finishes (providerFileId) or fails (errorMessage). The uploadId is the
 * capability token returned by /api/upload/initiate; finalizeUpload only
 * touches rows still in 'uploading' status.
 *
 * Body: { uploadId, providerFileId? , errorMessage? }
 * 200 { ok }
 * 400 invalid_request
 * 500 internal_error
 */
import { NextResponse, type NextRequest } from "next/server";
import { uploadFinalizeSchema } from "@/lib/schemas";
import { finalizeUpload } from "@/lib/uploads";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = uploadFinalizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await finalizeUpload(parsed.data);
    return NextResponse.json({ ok: result.ok });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upload/complete] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
