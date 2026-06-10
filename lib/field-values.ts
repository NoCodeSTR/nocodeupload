/**
 * Shared custom-field value helpers (isomorphic-safe; server uses them in the
 * upload + form-submit routes). Keeps validation identical across entry points.
 */

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Normalize/validate a custom-field value by type. */
export function cleanFieldValue(type: string, raw: string, options: string[]): string {
  switch (type) {
    case "select":
      return raw && options.includes(raw) ? raw : "";
    case "multiselect":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && options.includes(s))
        .join(", ");
    case "checkbox":
      return raw === "Yes" ? "Yes" : "";
    case "number":
    case "currency":
      return raw.replace(/[^0-9.\-]/g, "");
    case "email":
      return isValidEmail(raw) ? raw : "";
    default:
      return raw; // text, phone
  }
}
