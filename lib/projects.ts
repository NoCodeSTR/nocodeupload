/**
 * Server-side helpers for the projects table (owner-defined link groups).
 * Owner-scoped via the cookie-aware client + RLS.
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPgError } from "@/lib/pg-error";
import type { ProjectRow } from "@/lib/db-types";

export interface ProjectSummary {
  id: string;
  name: string;
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) throw new Error(formatPgError("Failed to list projects", error));
  return (data ?? []) as ProjectSummary[];
}

export async function createProject(userId: string, name: string): Promise<ProjectRow> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, name } as never)
    .select("*")
    .single();
  if (error) throw new Error(formatPgError("Failed to create project", error));
  return data as unknown as ProjectRow;
}

export async function deleteProject(args: { userId: string; id: string }): Promise<void> {
  const supabase = createSupabaseServerClient();
  // Links in this project are unassigned automatically (FK ON DELETE SET NULL).
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) throw new Error(formatPgError("Failed to delete project", error));
}
