/**
 * Merge tags for personalized form copy (isomorphic).
 *
 * Renders `{{token}}` and `{{token|fallback}}` against a value map (URL prefills
 * at page load, sample values in the builder preview). Tokens are normalized to
 * the same slug form as prefill keys (via prefillKey), so {{First Name}},
 * {{first_name}}, and a ?first_name= URL param all line up. An unmatched token
 * resolves to its fallback (or empty) — never the raw "{{…}}".
 */
import { prefillKey } from "@/lib/filename";

export function renderMergeTags(template: string, values: Record<string, string>): string {
  if (!template) return "";
  // Normalize value keys to the token slug form so lookups are consistent.
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v != null && String(v).trim() !== "") norm[prefillKey(k)] = String(v);
  }
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, inner: string) => {
    const [rawKey, ...rest] = String(inner).split("|");
    const fallback = rest.join("|").trim();
    const val = norm[prefillKey(rawKey)];
    return val && val.trim() ? val : fallback;
  });
}
