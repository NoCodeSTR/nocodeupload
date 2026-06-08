"use client";

/**
 * Per-link Airtable destination editor (rendered inside the link form).
 *
 * Lets the owner enable Airtable for this link, choose a base + table (loaded
 * live from their connected account), pick per-upload vs per-batch records, map
 * upload data → table fields, add constant values, and optionally attach the
 * file(s) to an attachment field.
 *
 * State is lifted: the parent owns the AirtableConfig and passes value/onChange.
 */
import { useCallback, useEffect, useState } from "react";
import { Table2, AlertCircle } from "lucide-react";
import { AIRTABLE_BUILTIN_SOURCES, customFieldSourceKey } from "@/lib/airtable/sources";
import type { AirtableConfig, CustomFieldDef } from "@/lib/db-types";

interface ApiBase {
  id: string;
  name: string;
}
interface ApiField {
  id: string;
  name: string;
  type: string;
}
interface ApiTable {
  id: string;
  name: string;
  fields: ApiField[];
}

// Field types we can't write a plain value into (computed / system fields).
const READONLY_TYPES = new Set([
  "formula",
  "rollup",
  "count",
  "createdTime",
  "lastModifiedTime",
  "createdBy",
  "lastModifiedBy",
  "autoNumber",
  "button",
  "externalSyncSource",
  "multipleLookupValues",
  "aiText",
]);
const ATTACHMENT_TYPE = "multipleAttachments";

const DEFAULT_CONFIG: AirtableConfig = {
  enabled: true,
  baseId: "",
  baseName: "",
  tableId: "",
  tableName: "",
  recordMode: "per_upload",
  attachFiles: false,
  attachFieldName: null,
  mapping: {},
  staticValues: [],
};

interface AirtableConfigEditorProps {
  connected: boolean;
  value: AirtableConfig | null;
  onChange: (cfg: AirtableConfig | null) => void;
  customFields: CustomFieldDef[];
}

export function AirtableConfigEditor({
  connected,
  value,
  onChange,
  customFields,
}: AirtableConfigEditorProps) {
  const enabled = Boolean(value?.enabled);

  const [bases, setBases] = useState<ApiBase[]>([]);
  const [tables, setTables] = useState<ApiTable[]>([]);
  const [loadingBases, setLoadingBases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const update = useCallback(
    (patch: Partial<AirtableConfig>) => {
      onChange({ ...(value ?? DEFAULT_CONFIG), ...patch });
    },
    [value, onChange],
  );

  const loadBases = useCallback(async () => {
    setLoadingBases(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/airtable/bases");
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "Connect Airtable in Settings → Airtable first."
            : "Couldn't load your Airtable bases.",
        );
      }
      const data = (await res.json()) as { bases?: ApiBase[] };
      setBases(data.bases ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Couldn't load bases.");
    } finally {
      setLoadingBases(false);
    }
  }, []);

  const loadTables = useCallback(async (baseId: string) => {
    setLoadingTables(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/airtable/tables?baseId=${encodeURIComponent(baseId)}`);
      if (!res.ok) throw new Error("Couldn't load tables for that base.");
      const data = (await res.json()) as { tables?: ApiTable[] };
      setTables(data.tables ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Couldn't load tables.");
      setTables([]);
    } finally {
      setLoadingTables(false);
    }
  }, []);

  // Lazy-load bases when first enabled; hydrate tables in edit mode.
  useEffect(() => {
    if (connected && enabled && bases.length === 0 && !loadingBases) void loadBases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, enabled]);
  useEffect(() => {
    if (connected && enabled && value?.baseId && tables.length === 0 && !loadingTables) {
      void loadTables(value.baseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, enabled, value?.baseId]);

  function toggleEnable(checked: boolean) {
    if (checked) {
      onChange({ ...(value ?? DEFAULT_CONFIG), enabled: true });
    } else {
      onChange(value ? { ...value, enabled: false } : null);
    }
  }

  function pickBase(baseId: string) {
    const b = bases.find((x) => x.id === baseId);
    update({ baseId, baseName: b?.name ?? "", tableId: "", tableName: "", mapping: {}, attachFieldName: null });
    setTables([]);
    if (baseId) void loadTables(baseId);
  }

  function pickTable(tableId: string) {
    const t = tables.find((x) => x.id === tableId);
    // Field names belong to the table — changing tables clears the mapping.
    update({ tableId, tableName: t?.name ?? "", mapping: {}, attachFieldName: null });
  }

  function setMapping(sourceKey: string, fieldName: string) {
    const m = { ...(value?.mapping ?? {}) };
    if (fieldName) m[sourceKey] = fieldName;
    else delete m[sourceKey];
    update({ mapping: m });
  }

  function addStatic() {
    update({ staticValues: [...(value?.staticValues ?? []), { field: "", value: "" }] });
  }
  function updateStatic(idx: number, patch: Partial<{ field: string; value: string }>) {
    update({
      staticValues: (value?.staticValues ?? []).map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  }
  function removeStatic(idx: number) {
    update({ staticValues: (value?.staticValues ?? []).filter((_, i) => i !== idx) });
  }

  if (!connected) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          Connect your Airtable account in <strong>Settings → Airtable</strong> to send uploads into a
          table.
        </span>
      </div>
    );
  }

  const selectedTable = tables.find((t) => t.id === value?.tableId);
  const mappingFields = selectedTable
    ? selectedTable.fields.filter((f) => !READONLY_TYPES.has(f.type) && f.type !== ATTACHMENT_TYPE)
    : [];
  const attachmentFields = selectedTable
    ? selectedTable.fields.filter((f) => f.type === ATTACHMENT_TYPE)
    : [];

  const sources = [
    ...AIRTABLE_BUILTIN_SOURCES.map((s) => ({ key: s.key, label: s.label, hint: s.hint })),
    ...customFields
      .filter((f) => f.label.trim())
      .map((f) => ({ key: customFieldSourceKey(f.label.trim()), label: f.label.trim(), hint: "Custom field" })),
  ];

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={enabled} onChange={(e) => toggleEnable(e.target.checked)} />
        <Table2 className="h-4 w-4 text-ink-500" />
        Create an Airtable record on every upload
      </label>

      {enabled && (
        <div className="space-y-4 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          {/* Base + table */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1">Base</label>
              <select
                className="input"
                value={value?.baseId ?? ""}
                onChange={(e) => pickBase(e.target.value)}
                disabled={loadingBases}
              >
                <option value="">{loadingBases ? "Loading…" : "Choose a base…"}</option>
                {/* Keep the saved base selectable even if the list hasn't loaded yet. */}
                {value?.baseId && !bases.some((b) => b.id === value.baseId) && (
                  <option value={value.baseId}>{value.baseName || value.baseId}</option>
                )}
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label mb-1">Table</label>
              <select
                className="input"
                value={value?.tableId ?? ""}
                onChange={(e) => pickTable(e.target.value)}
                disabled={!value?.baseId || loadingTables}
              >
                <option value="">{loadingTables ? "Loading…" : "Choose a table…"}</option>
                {value?.tableId && !tables.some((t) => t.id === value.tableId) && (
                  <option value={value.tableId}>{value.tableName || value.tableId}</option>
                )}
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {fetchError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{fetchError}</span>
            </div>
          )}

          {/* Record mode */}
          <div>
            <span className="label mb-1 block">Create a record…</span>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="airtable-record-mode"
                  checked={(value?.recordMode ?? "per_upload") === "per_upload"}
                  onChange={() => update({ recordMode: "per_upload" })}
                />
                Per file
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="airtable-record-mode"
                  checked={value?.recordMode === "per_batch"}
                  onChange={() => update({ recordMode: "per_batch" })}
                />
                Per submission (one row even if several files are sent at once)
              </label>
            </div>
          </div>

          {/* Field mapping */}
          {selectedTable ? (
            <div className="space-y-2">
              <span className="label block">Map upload data → Airtable fields</span>
              <div className="space-y-1.5">
                {sources.map((s) => (
                  <div key={s.key} className="flex flex-wrap items-center gap-2 text-sm">
                    <div className="min-w-[9rem] flex-1">
                      <span className="text-ink-700 dark:text-ink-200">{s.label}</span>
                      {s.hint && <span className="ml-1 text-xs text-ink-400">({s.hint})</span>}
                    </div>
                    <span className="text-ink-400">→</span>
                    <select
                      className="input w-auto min-w-[10rem] flex-1"
                      value={value?.mapping?.[s.key] ?? ""}
                      onChange={(e) => setMapping(s.key, e.target.value)}
                    >
                      <option value="">Don&apos;t sync</option>
                      {mappingFields.map((f) => (
                        <option key={f.id} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-400">
                Only the rows you map are written. Computed fields (formulas, rollups, etc.) and
                attachment fields are hidden here — Airtable can&apos;t accept a plain value for those.
              </p>
            </div>
          ) : (
            value?.baseId && (
              <p className="text-xs text-ink-400">Choose a table to map fields.</p>
            )
          )}

          {/* Static values */}
          {selectedTable && (
            <div className="space-y-2">
              <span className="label block">
                Constant values <span className="font-normal text-ink-400">(optional)</span>
              </span>
              {(value?.staticValues ?? []).map((sv, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 text-sm">
                  <select
                    className="input w-auto min-w-[9rem]"
                    value={sv.field}
                    onChange={(e) => updateStatic(idx, { field: e.target.value })}
                  >
                    <option value="">Choose field…</option>
                    {mappingFields.map((f) => (
                      <option key={f.id} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-ink-400">=</span>
                  <input
                    className="input w-auto flex-1"
                    value={sv.value}
                    onChange={(e) => updateStatic(idx, { value: e.target.value })}
                    placeholder="Value (e.g. Guest upload)"
                    maxLength={500}
                  />
                  <button
                    type="button"
                    onClick={() => removeStatic(idx)}
                    className="px-2 text-lg leading-none text-ink-400 hover:text-red-600"
                    aria-label="Remove constant"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addStatic}
                className="text-xs font-medium text-brand hover:underline"
              >
                + Add constant value
              </button>
            </div>
          )}

          {/* Attachments */}
          {selectedTable && (
            <div className="space-y-2 border-t border-ink-100 pt-3 dark:border-ink-800">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(value?.attachFiles)}
                  onChange={(e) => update({ attachFiles: e.target.checked, attachFieldName: e.target.checked ? value?.attachFieldName ?? null : null })}
                />
                <span>
                  Also attach the file(s) to an attachment field
                  <span className="block text-xs text-ink-400">
                    Google Drive only. We briefly share each file so Airtable can copy it in, then
                    revoke the share. Leave off to just store the file link (recommended for large
                    videos).
                  </span>
                </span>
              </label>
              {value?.attachFiles && (
                <div>
                  {attachmentFields.length > 0 ? (
                    <select
                      className="input"
                      value={value?.attachFieldName ?? ""}
                      onChange={(e) => update({ attachFieldName: e.target.value || null })}
                    >
                      <option value="">Choose an attachment field…</option>
                      {attachmentFields.map((f) => (
                        <option key={f.id} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-900/40">
                      This table has no attachment field. Add one in Airtable, then reopen this form.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
