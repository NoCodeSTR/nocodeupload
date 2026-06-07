/**
 * Server-side helpers for tags + link_tags (reusable cross-cutting labels).
 *
 * Tags are a get-or-create vocabulary: assigning a tag name that doesn't exist
 * yet creates it (case-insensitively de-duped against the user's existing tags),
 * so it then shows up as a suggestion on future links.
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPgError } from "@/lib/pg-error";

export interface TagSummary {
  id: string;
  name: string;
}

/** All of the user's tags (the suggestion vocabulary), alphabetical. */
export async function listTags(userId: string): Promise<TagSummary[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tags")
    .select("id, name")
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) throw new Error(formatPgError("Failed to list tags", error));
  return (data ?? []) as TagSummary[];
}

/** Map of link id → tag names, for the whole dashboard (display + search). */
export async function getTagsForLinks(userId: string): Promise<Record<string, string[]>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("link_tags")
    .select("link_id, tags(name)")
    .eq("user_id", userId);
  if (error) throw new Error(formatPgError("Failed to load link tags", error));
  // PostgREST returns the related tag as an object, but the generic client may
  // type it as an array — handle both.
  const rows = (data ?? []) as unknown as Array<{
    link_id: string;
    tags: { name: string } | { name: string }[] | null;
  }>;
  const map: Record<string, string[]> = {};
  for (const row of rows) {
    const t = row.tags;
    const name = Array.isArray(t) ? t[0]?.name : t?.name;
    if (!name) continue;
    (map[row.link_id] ??= []).push(name);
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => a.localeCompare(b));
  return map;
}

/** Tag names for a single link (for the edit form's initial state). */
export async function getTagsForLink(userId: string, linkId: string): Promise<string[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("link_tags")
    .select("tags(name)")
    .eq("user_id", userId)
    .eq("link_id", linkId);
  if (error) throw new Error(formatPgError("Failed to load link tags", error));
  const rows = (data ?? []) as unknown as Array<{
    tags: { name: string } | { name: string }[] | null;
  }>;
  return rows
    .map((r) => (Array.isArray(r.tags) ? r.tags[0]?.name : r.tags?.name))
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Replace a link's tags with `names`. Get-or-creates each tag (case-insensitive
 * de-dupe vs the user's existing tags), then rewrites the link_tags rows.
 * Best-effort by design — callers wrap so a tag hiccup never fails a link save.
 */
export async function setLinkTags(userId: string, linkId: string, names: string[]): Promise<void> {
  const supabase = createSupabaseServerClient();

  // Normalize + de-dupe (case-insensitive), cap, keep first-seen casing.
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(name);
    if (clean.length >= 20) break;
  }

  // Load existing tags so we reuse ids and only create the genuinely new ones.
  const { data: existingData, error: exErr } = await supabase
    .from("tags")
    .select("id, name")
    .eq("user_id", userId);
  if (exErr) throw new Error(formatPgError("Failed to read tags", exErr));
  const byLower = new Map<string, string>(); // lower(name) -> id
  for (const t of (existingData ?? []) as TagSummary[]) byLower.set(t.name.toLowerCase(), t.id);

  const tagIds: string[] = [];
  const toCreate = clean.filter((n) => !byLower.has(n.toLowerCase()));
  if (toCreate.length > 0) {
    const { data: created, error: cErr } = await supabase
      .from("tags")
      .insert(toCreate.map((name) => ({ user_id: userId, name })) as never)
      .select("id, name");
    if (cErr) throw new Error(formatPgError("Failed to create tags", cErr));
    for (const t of (created ?? []) as TagSummary[]) byLower.set(t.name.toLowerCase(), t.id);
  }
  for (const n of clean) {
    const id = byLower.get(n.toLowerCase());
    if (id) tagIds.push(id);
  }

  // Rewrite the join rows for this link.
  const { error: delErr } = await supabase
    .from("link_tags")
    .delete()
    .eq("user_id", userId)
    .eq("link_id", linkId);
  if (delErr) throw new Error(formatPgError("Failed to clear link tags", delErr));

  if (tagIds.length > 0) {
    const { error: insErr } = await supabase
      .from("link_tags")
      .insert(tagIds.map((tag_id) => ({ link_id: linkId, tag_id, user_id: userId })) as never);
    if (insErr) throw new Error(formatPgError("Failed to assign link tags", insErr));
  }
}
