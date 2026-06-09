/**
 * Conditional-field visibility (isomorphic — used by the public uploader to
 * show/hide fields live, and by the server to skip required-checks and storage
 * for fields that weren't shown).
 *
 * A field with `showWhen` is visible only when its controlling field currently
 * holds one of the listed values. Values are keyed by FIELD ID (the same keys
 * the public form and the initiate route use for customValues).
 */
import type { FieldCondition } from "@/lib/db-types";

export function isFieldVisible(
  showWhen: FieldCondition | null | undefined,
  valuesById: Record<string, string>,
): boolean {
  if (!showWhen || !showWhen.fieldId) return true;
  const raw = (valuesById[showWhen.fieldId] ?? "").trim();
  if (!raw) return false;
  const wanted = new Set(showWhen.values.map((v) => v.trim()).filter(Boolean));
  if (wanted.size === 0) return true;
  if (wanted.has(raw)) return true;
  // Multiselect controllers store a comma-joined value — match any selected part.
  return raw
    .split(",")
    .map((s) => s.trim())
    .some((part) => wanted.has(part));
}
