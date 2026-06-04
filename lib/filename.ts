/**
 * Smart filename templating — isomorphic (used server-side to rename the Drive
 * file at upload, and client-side for the live preview in the link form).
 *
 * Tokens:
 *   {date}      → 2026-04-25            (year-first, sorts chronologically)
 *   {time}      → 1643                  (24h HHMM — no colons; colons break Drive/Windows)
 *   {datetime}  → 2026-04-25-1643
 *   {name}      → uploader name (slugified)
 *   {email}     → uploader email (slugified)
 *   {original}  → original filename without extension
 *   {field:Label} → a custom field's value, matched by label (case-insensitive)
 *
 * Output is kebab-cased and safe; the original extension is preserved. Empty
 * tokens collapse cleanly (no stray "--"). Falls back to the original name if
 * the template is empty or renders to nothing.
 */

function slug(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function splitExt(filename: string): { base: string; ext: string } {
  const i = filename.lastIndexOf(".");
  if (i <= 0 || i === filename.length - 1) return { base: filename, ext: "" };
  return { base: filename.slice(0, i), ext: filename.slice(i + 1).toLowerCase() };
}

export interface FilenameContext {
  originalFilename: string;
  uploaderName?: string | null;
  uploaderEmail?: string | null;
  customData?: Record<string, string>;
  date?: Date;
}

export function renderFilename(template: string | null | undefined, ctx: FilenameContext): string {
  const { base, ext } = splitExt(ctx.originalFilename);

  // No template → keep the original filename unchanged.
  if (!template || !template.trim()) return ctx.originalFilename;

  const d = ctx.date ?? new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const tokens: Record<string, string> = {
    date,
    time,
    datetime: `${date}-${time}`,
    name: slug(ctx.uploaderName ?? ""),
    email: slug(ctx.uploaderEmail ?? ""),
    original: slug(base),
  };

  let out = template;

  // {field:Label} — case-insensitive label lookup in custom_data.
  out = out.replace(/\{field:([^}]+)\}/gi, (_m, label: string) => {
    const cd = ctx.customData ?? {};
    const key = Object.keys(cd).find((k) => k.toLowerCase() === label.trim().toLowerCase());
    return slug(key ? cd[key] : "");
  });

  // Simple {token}s.
  out = out.replace(/\{(\w+)\}/g, (_m, t: string) => tokens[t.toLowerCase()] ?? "");

  // Normalize: kebab-case, collapse separators, trim.
  out = out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);

  if (!out) out = slug(base) || "upload";
  return ext ? `${out}.${ext}` : out;
}
