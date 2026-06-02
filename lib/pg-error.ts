/**
 * Format a Supabase/PostgREST error into something debuggable.
 *
 * PostgrestError carries message, code, details, and hint — but a plain
 * `error.message` is often empty (notably for body-less requests). Always
 * surface all four so production logs point straight at the cause
 * (42501 = permission denied, 42P01 = undefined table, 23505 = unique
 * violation, 23503 = FK violation, etc.).
 */
export function formatPgError(
  prefix: string,
  error: { message?: string; code?: string; details?: string; hint?: string },
): string {
  const parts = [
    error.message && error.message.length > 0 ? error.message : "(empty message)",
    error.code ? `code=${error.code}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ].filter(Boolean);
  return `${prefix}: ${parts.join(" | ")}`;
}
