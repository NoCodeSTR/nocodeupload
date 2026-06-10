"use client";

/**
 * "Import fields from Airtable" — pick a base + table, choose which columns to
 * pull in, and emit form fields that mirror them (with the right type + select
 * options). The parent (link form) creates matching custom fields AND wires the
 * Airtable write-back so each field's answer round-trips to its source column.
 */
import { useCallback, useState } from "react";
import { Table2, Download, AlertCircle } from "lucide-react";
import { SearchableSelect, type SelectOption } from "@/components/searchable-select";
import type { CustomFieldType } from "@/lib/db-types";

interface ApiBase {
  id: string;
  name: string;
}
interface ApiField {
  id: string;
  name: string;
  type: string;
  options?: string[];
}
interface ApiTable {
  id: string;
  name: string;
  fields: ApiField[];
}

// Airtable field type → our form field type. Types not listed aren't importable
// as inputs (attachments, formulas, rollups, lookups, collaborators, etc.).
const TYPE_MAP: Record<string, CustomFieldType> = {
  singleLineText: "text",
  multilineText: "text",
  richText: "text",
  email: "email",
  phoneNumber: "phone",
  url: "text",
  number: "number",
  currency: "currency",
  percent: "number",
  duration: "number",
  rating: "number",
  singleSelect: "select",
  multipleSelects: "multiselect",
  checkbox: "checkbox",
  date: "text",
  dateTime: "text",
};

export interface ImportedAirtableField {
  label: string;
  type: CustomFieldType;
  options?: string[];
}

interface AirtableImportProps {
  onImport: (result: {
    baseId: string;
    baseName: string;
    tableId: string;
    tableName: string;
    fields: ImportedAirtableField[];
  }) => void;
}

export function AirtableImport({ onImport }: AirtableImportProps) {
  const [open, setOpen] = useState(false);
  const [bases, setBases] = useState<ApiBase[]>([]);
  const [tables, setTables] = useState<ApiTable[]>([]);
  const [baseId, setBaseId] = useState("");
  const [tableId, setTableId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingBases, setLoadingBases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justImported, setJustImported] = useState(0);

  const loadBases = useCallback(async () => {
    setLoadingBases(true);
    setError(null);
    try {
      const res = await fetch("/api/airtable/bases");
      if (!res.ok) throw new Error(res.status === 404 ? "Connect Airtable in Settings first." : "Couldn't load bases.");
      const data = (await res.json()) as { bases?: ApiBase[] };
      setBases(data.bases ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load bases.");
    } finally {
      setLoadingBases(false);
    }
  }, []);

  const loadTables = useCallback(async (id: string) => {
    setLoadingTables(true);
    setError(null);
    try {
      const res = await fetch(`/api/airtable/tables?baseId=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Couldn't load tables.");
      const data = (await res.json()) as { tables?: ApiTable[] };
      setTables(data.tables ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load tables.");
      setTables([]);
    } finally {
      setLoadingTables(false);
    }
  }, []);

  function openPanel() {
    setOpen(true);
    setJustImported(0);
    if (bases.length === 0) void loadBases();
  }
  function pickBase(id: string) {
    setBaseId(id);
    setTableId("");
    setTables([]);
    setSelected(new Set());
    if (id) void loadTables(id);
  }
  function pickTable(id: string) {
    setTableId(id);
    const t = tables.find((x) => x.id === id);
    const importable = (t?.fields ?? []).filter((f) => TYPE_MAP[f.type]);
    // Default: select every importable field.
    setSelected(new Set(importable.map((f) => f.id)));
  }

  const base = bases.find((b) => b.id === baseId);
  const table = tables.find((t) => t.id === tableId);
  const importable = (table?.fields ?? []).filter((f) => TYPE_MAP[f.type]);
  const skipped = (table?.fields ?? []).length - importable.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function doImport() {
    if (!base || !table) return;
    const fields: ImportedAirtableField[] = importable
      .filter((f) => selected.has(f.id))
      .map((f) => {
        const type = TYPE_MAP[f.type];
        const options = type === "select" || type === "multiselect" ? f.options ?? [] : undefined;
        return { label: f.name, type, options };
      });
    if (fields.length === 0) return;
    onImport({ baseId: base.id, baseName: base.name, tableId: table.id, tableName: table.name, fields });
    setJustImported(fields.length);
    setOpen(false);
  }

  const baseOptions: SelectOption[] = bases.map((b) => ({ value: b.id, label: b.name }));
  const tableOptions: SelectOption[] = tables.map((t) => ({ value: t.id, label: t.name }));

  if (!open) {
    return (
      <div>
        <button type="button" onClick={openPanel} className="btn-secondary text-sm">
          <Table2 className="h-4 w-4" />
          Import fields from Airtable
        </button>
        {justImported > 0 && (
          <p className="mt-1.5 text-xs text-green-700 dark:text-green-300">
            Imported {justImported} field{justImported === 1 ? "" : "s"} — and set this link to send
            answers back to that table. Tweak them below or in the Airtable section.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-900 dark:bg-brand-900/20">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label mb-1 block">Base</label>
          <SearchableSelect
            value={baseId}
            onChange={pickBase}
            options={baseOptions}
            loading={loadingBases}
            placeholder="Choose a base…"
            searchPlaceholder="Search bases…"
            ariaLabel="Airtable base to import from"
          />
        </div>
        <div>
          <label className="label mb-1 block">Table</label>
          <SearchableSelect
            value={tableId}
            onChange={pickTable}
            options={tableOptions}
            loading={loadingTables}
            disabled={!baseId}
            placeholder="Choose a table…"
            searchPlaceholder="Search tables…"
            ariaLabel="Airtable table to import from"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {table && (
        <div>
          {importable.length === 0 ? (
            <p className="text-xs text-ink-500">
              No importable columns in this table (attachment / formula / rollup columns can&apos;t
              become form fields).
            </p>
          ) : (
            <>
              <p className="mb-1.5 text-xs text-ink-500">Choose which columns to pull in as form fields:</p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-ink-200 p-2 dark:border-ink-700">
                {importable.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                    <span className="text-ink-700 dark:text-ink-200">{f.name}</span>
                    <span className="text-xs text-ink-400">({TYPE_MAP[f.type]})</span>
                  </label>
                ))}
              </div>
              {skipped > 0 && (
                <p className="mt-1 text-xs text-ink-400">
                  {skipped} column{skipped === 1 ? "" : "s"} skipped (not a fillable type).
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={doImport}
          disabled={!table || selected.size === 0}
          className="btn-primary text-sm"
        >
          <Download className="h-4 w-4" />
          Import {selected.size > 0 ? selected.size : ""} field{selected.size === 1 ? "" : "s"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
