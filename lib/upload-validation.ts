/**
 * Isomorphic upload validation helpers — safe to import in both client
 * components and server routes (no server-only dependencies).
 */

/**
 * Is `mime` allowed by the link's allowed_mime_types?
 * - null / empty array  → any type allowed
 * - "image/*"           → prefix match (image/jpeg, image/png, …)
 * - "application/pdf"   → exact match
 */
export function mimeAllowed(mime: string, patterns: string[] | null | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  const m = (mime || "").toLowerCase();
  return patterns.some((p) => {
    const pat = p.toLowerCase();
    if (pat.endsWith("/*")) return m.startsWith(pat.slice(0, -1)); // "image/"
    return m === pat;
  });
}

/** Human-readable label for the allowed types (for the public page). */
export function allowedTypesLabel(patterns: string[] | null | undefined): string {
  if (!patterns || patterns.length === 0) return "Any file type";
  const labels = patterns.map((p) => {
    if (p === "image/*") return "Images";
    if (p === "video/*") return "Videos";
    if (p === "application/pdf") return "PDFs";
    return p;
  });
  return Array.from(new Set(labels)).join(", ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 2 : 1)} GB`;
}

export function formatSizeMb(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}
