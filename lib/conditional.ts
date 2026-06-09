/**
 * Conditional-field visibility (isomorphic — used by the public uploader to
 * show/hide fields live, and by the server to skip required-checks and storage
 * for fields that weren't shown).
 *
 * A field with `showWhen` is visible only when its controlling field satisfies
 * the operator. Any field type can be a controller; the editor offers a
 * type-aware operator subset. Values are keyed by FIELD ID (the same keys the
 * public form and the initiate route use for customValues).
 */
import type { FieldCondition } from "@/lib/db-types";

export function isFieldVisible(
  showWhen: FieldCondition | null | undefined,
  valuesById: Record<string, string>,
): boolean {
  if (!showWhen || !showWhen.fieldId) return true;

  const raw = (valuesById[showWhen.fieldId] ?? "").trim();
  const op = showWhen.op ?? "has_any_of"; // back-compat default
  const values = (showWhen.values ?? []).map((v) => v.trim()).filter(Boolean);
  const first = values[0] ?? "";
  const lc = raw.toLowerCase();
  // Multiselect controllers store a comma-joined value; treat as a set of parts.
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const wanted = new Set(values.map((v) => v.toLowerCase()));
  const anyOf = parts.some((p) => wanted.has(p));

  switch (op) {
    case "is_filled":
      return raw !== "";
    case "is_empty":
      return raw === "";
    case "equals":
      return first !== "" && lc === first.toLowerCase();
    case "not_equals":
      return lc !== first.toLowerCase();
    case "contains":
      return first !== "" && lc.includes(first.toLowerCase());
    case "not_contains":
      return first === "" || !lc.includes(first.toLowerCase());
    case "has_any_of":
      return anyOf;
    case "has_none_of":
      return !anyOf;
    case "greater_than": {
      const a = parseFloat(raw);
      const b = parseFloat(first);
      return !Number.isNaN(a) && !Number.isNaN(b) && a > b;
    }
    case "less_than": {
      const a = parseFloat(raw);
      const b = parseFloat(first);
      return !Number.isNaN(a) && !Number.isNaN(b) && a < b;
    }
    default:
      return anyOf;
  }
}
