"use client";

/**
 * Preview Mode record picker — pick a real record from a connected table so the
 * builder can substitute its values into headings, text, file naming, and the
 * uploader-view preview. Loads up to 25 records (labeled by the table's primary
 * field), and on selection fetches that record's full fields and reports them
 * back namespaced as `${aliasKey}.${fieldKey}`.
 */
import { useEffect, useState } from "react";
import { SearchableSelect, type SelectOption } from "@/components/searchable-select";
import { prefillKey } from "@/lib/filename";

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "";
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x == null) return "";
        if (typeof x === "string" || typeof x === "number") return String(x);
        if (typeof x === "object") {
          const o = x as Record<string, unknown>;
          return String(o.name ?? o.text ?? o.email ?? o.url ?? o.id ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o.name ?? o.text ?? o.email ?? o.url ?? o.id ?? "");
  }
  return "";
}

const enc = encodeURIComponent;

interface PreviewRecordPickerProps {
  baseId: string;
  tableId: string;
  primaryField: string;
  aliasKey: string;
  sourceLabel: string;
  onPick: (aliasKey: string, values: Record<string, string>, recordLabel: string) => void;
}

export function PreviewRecordPicker({
  baseId,
  tableId,
  primaryField,
  aliasKey,
  sourceLabel,
  onPick,
}: PreviewRecordPickerProps) {
  const [records, setRecords] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/airtable/records?baseId=${enc(baseId)}&tableId=${enc(tableId)}&primaryField=${enc(primaryField)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { records?: Array<{ id: string; label: string }> };
          if (!cancelled) setRecords(data.records ?? []);
        }
      } catch {
        /* non-fatal — preview is best-effort */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseId, tableId, primaryField]);

  async function pick(id: string) {
    setSelectedId(id);
    if (!id) {
      onPick(aliasKey, {}, "");
      return;
    }
    try {
      const res = await fetch(`/api/airtable/records?baseId=${enc(baseId)}&tableId=${enc(tableId)}&recordId=${enc(id)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { record?: { fields?: Record<string, unknown> } };
      const fields = data.record?.fields ?? {};
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        const s = cellToString(v);
        if (s) values[`${aliasKey}.${prefillKey(k)}`] = s;
      }
      const label = records.find((r) => r.id === id)?.label ?? id;
      onPick(aliasKey, values, label);
    } catch {
      /* non-fatal */
    }
  }

  const options: SelectOption[] = records.map((r) => ({ value: r.id, label: r.label || r.id }));

  return (
    <div>
      <label className="label mb-1 block text-xs">{sourceLabel}</label>
      <SearchableSelect
        value={selectedId}
        onChange={pick}
        options={options}
        loading={loading}
        placeholder="Pick a record to preview…"
        searchPlaceholder="Search records…"
        ariaLabel={`Preview record for ${sourceLabel}`}
      />
    </div>
  );
}
