/**
 * POST /api/projects — create a project (owner-scoped).
 * 201 { id, name } | 400 invalid_request
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { projectCreateSchema } from "@/lib/schemas";
import { createProject } from "@/lib/projects";

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const project = await createProject(user.id, parsed.data.name.trim());
    return NextResponse.json({ id: project.id, name: project.name }, { status: 201 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/projects] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
