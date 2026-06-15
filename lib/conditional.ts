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
import type { FieldCondition, FieldConditionOp } from "@/lib/db-types";

/**
 * Evaluate one condition operator against a raw field value + comparison values.
 * Shared by field visibility (showWhen) and notification routing rules so both
 * support the same operator set (is filled, any of, none of, etc.).
 */
export function evalCondition(
  op: FieldConditionOp | undefined,
  rawValue: string,
  values: string[],
): boolean {
  const raw = (rawValue ?? "").trim();
  const vals = (values ?? []).map((v) => v.trim()).filter(Boolean);
  const first = vals[0] ?? "";
  const lc = raw.toLowerCase();
  // Multiselect values are comma-joined; treat as a set of parts.
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const wanted = new Set(vals.map((v) => v.toLowerCase()));
  const anyOf = parts.some((p) => wanted.has(p));

  switch (op ?? "has_any_of") {
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

export function isFieldVisible(
  showWhen: FieldCondition | null | undefined,
  valuesById: Record<string, string>,
): boolean {
  if (!showWhen || !showWhen.fieldId) return true;
  return evalCondition(showWhen.op, valuesById[showWhen.fieldId] ?? "", showWhen.values ?? []);
}
