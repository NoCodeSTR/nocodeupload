import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The account's default accent color (#rrggbb), or null if none is set. Seeds
 * the brand color on new upload links. Best-effort: returns null on any error so
 * the link form still renders.
 */
export async function getAccountDefaultAccentColor(userId: string): Promise<string | null> {
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("profiles")
      .select("default_accent_color")
      .eq("id", userId)
      .maybeSingle();
    return (data as { default_accent_color: string | null } | null)?.default_accent_color ?? null;
  } catch {
    return null;
  }
}
