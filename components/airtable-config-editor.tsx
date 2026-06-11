"use client";

/**
 * Per-link Airtable destination editor (rendered inside the link form).
 *
 * Lets the owner enable Airtable for this link, choose a base + table (loaded
 * live from their connected account, with searchable pickers for large bases),
 * pick per-upload vs per-batch records, map upload data → table fields, add
 * constant values, and optionally attach the file(s) to an attachment field.
 *
 * "Refresh fields" re-pulls the schema so a field you just added in Airtable
 * shows up without leaving the form. State is lifted: the parent owns the
 * AirtableConfig and passes value/onChange.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Table2, AlertCircle, RefreshCw } from "lucide-react";
import { SearchableSelect, type SelectOption } from "@/components/searchable-select";
import {
  AIRTABLE_BUILTIN_SOURCES,
  customFieldSourceKey,
  recordSourceLinkKey,
  recordSourceValueKey,
} from "@/lib/airtable/sources";
import { prefillKey } from "@/lib/filename";
import type { AirtableConfig, CustomFieldDef, RecordSource } from "@/lib/db-types";

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

// Single-value formatted fields that can't hold several newline-joined values.
const SINGLE_FORMAT_TYPES = new Set(["url", "email", "phoneNumber"]);
// Sources that can produce several values (one per file) in per-submission mode.
const MULTI_VALUE_SOURCES = new Set(["link", "filename", "filetype"]);

const TYPE_LABELS: Record<string, string> = {
  singleLineText: "Text",
  multilineText: "Long text",
  richText: "Rich text",
  url: "URL",
  email: "Email",
  phoneNumber: "Phone",
  number: "Number",
  currency: "Currency",
  percent: "Percent",
  singleSelect: "Single select",
  multipleSelects: "Multi-select",
  date: "Date",
  dateTime: "Date/time",
  checkbox: "Checkbox",
  multipleAttachments: "Attachment",
  rating: "Rating",
  duration: "Duration",
  barcode: "Barcode",
};
function prettyType(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

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
  const perBatch = value?.recordMode === "per_batch";

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

  // --- Record sources (pull data from other tables in the same base) ---------
  const recordSources = value?.recordSources ?? [];
  function patchSources(next: RecordSource[]) {
    update({ recordSources: next });
  }
  function addSource() {
    patchSources([
      ...recordSources,
      {
        id: crypto.randomUUID(),
        alias: "",
        label: "",
        tableId: "",
        tableName: "",
        fields: [],
        visible: false,
        required: false,
        instructions: null,
      },
    ]);
  }
  function updateSource(id: string, patch: Partial<RecordSource>) {
    patchSources(recordSources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeSource(id: string) {
    patchSources(recordSources.filter((s) => s.id !== id));
  }
  function pickSourceTable(id: string, tableId: string) {
    const t = tables.find((x) => x.id === tableId);
    updateSource(id, { tableId, tableName: t?.name ?? "" });
  }

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === value?.tableId) ?? null,
    [tables, value?.tableId],
  );

  const mappingFields = useMemo(
    () =>
      selectedTable
        ? selectedTable.fields.filter((f) => !READONLY_TYPES.has(f.type) && f.type !== ATTACHMENT_TYPE)
        : [],
    [selectedTable],
  );
  const attachmentFields = useMemo(
    () => (selectedTable ? selectedTable.fields.filter((f) => f.type === ATTACHMENT_TYPE) : []),
    [selectedTable],
  );

  // Option lists for the searchable pickers.
  const baseOptions: SelectOption[] = useMemo(() => {
    const opts = bases.map((b) => ({ value: b.id, label: b.name }));
    if (value?.baseId && !opts.some((o) => o.value === value.baseId)) {
      opts.unshift({ value: value.baseId, label: value.baseName || value.baseId });
    }
    return opts;
  }, [bases, value?.baseId, value?.baseName]);

  const tableOptions: SelectOption[] = useMemo(() => {
    const opts = tables.map((t) => ({ value: t.id, label: t.name }));
    if (value?.tableId && !opts.some((o) => o.value === value.tableId)) {
      opts.unshift({ value: value.tableId, label: value.tableName || value.tableId });
    }
    return opts;
  }, [tables, value?.tableId, value?.tableName]);

  const mappingOptions: SelectOption[] = useMemo(
    () => mappingFields.map((f) => ({ value: f.name, label: f.name, hint: prettyType(f.type) })),
    [mappingFields],
  );
  const attachmentOptions: SelectOption[] = useMemo(
    () => attachmentFields.map((f) => ({ value: f.name, label: f.name })),
    [attachmentFields],
  );

  function mappingWarning(sourceKey: string, fieldName: string | undefined): string | null {
    if (!fieldName || !perBatch || !MULTI_VALUE_SOURCES.has(sourceKey)) return null;
    const t = selectedTable?.fields.find((f) => f.name === fieldName)?.type;
    if (t && SINGLE_FORMAT_TYPES.has(t)) {
      return `Per-submission mode can write one value per file here. A ${prettyType(t)} field only holds one — use a Single line text or Long text field for multiple.`;
    }
    return null;
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

  const sources = [
    ...AIRTABLE_BUILTIN_SOURCES.map((s) => ({ key: s.key, label: s.label, hint: s.hint })),
    ...customFields
      .filter((f) => f.label.trim())
      .map((f) => ({ key: customFieldSourceKey(f.label.trim()), label: f.label.trim(), hint: "Custom field" })),
    // Record sources: link the referenced record into a linked field, and copy
    // ANY of the connected table's fields into a destination field (the builder
    // shows the full schema; the record is fetched server-side at write time).
    ...recordSources.flatMap((src) => {
      const aliasKey = prefillKey(src.alias || "");
      if (!aliasKey || !src.tableId) return [];
      const name = src.alias.trim() || src.tableName || "source";
      const srcTable = tables.find((t) => t.id === src.tableId);
      return [
        { key: recordSourceLinkKey(aliasKey), label: `${name} (record link)`, hint: "Linked record" },
        ...(srcTable?.fields ?? []).map((f) => ({
          key: recordSourceValueKey(aliasKey, f.name),
          label: `${name} · ${f.name}`,
          hint: "Pulled value",
        })),
      ];
    }),
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
              <div className="mb-1 flex items-center justify-between">
                <label className="label">Base</label>
                <button
                  type="button"
                  onClick={() => void loadBases()}
                  disabled={loadingBases}
                  className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800 disabled:opacity-50 dark:hover:text-ink-200"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingBases ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
              <SearchableSelect
                value={value?.baseId ?? ""}
                onChange={pickBase}
                options={baseOptions}
                loading={loadingBases}
                placeholder="Choose a base…"
                searchPlaceholder="Search bases…"
                ariaLabel="Airtable base"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="label">Table</label>
                {value?.baseId && (
                  <button
                    type="button"
                    onClick={() => value?.baseId && void loadTables(value.baseId)}
                    disabled={loadingTables}
                    className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800 disabled:opacity-50 dark:hover:text-ink-200"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingTables ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                )}
              </div>
              <SearchableSelect
                value={value?.tableId ?? ""}
                onChange={pickTable}
                options={tableOptions}
                loading={loadingTables}
                disabled={!value?.baseId}
                placeholder="Choose a table…"
                searchPlaceholder="Search tables…"
                ariaLabel="Airtable table"
              />
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
                  checked={perBatch}
                  onChange={() => update({ recordMode: "per_batch" })}
                />
                Per submission (one row even if several files are sent at once)
              </label>
            </div>
          </div>

          {/* Field mapping */}
          {selectedTable ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="label">Map upload data → Airtable fields</span>
                <button
                  type="button"
                  onClick={() => value?.baseId && void loadTables(value.baseId)}
                  disabled={loadingTables}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingTables ? "animate-spin" : ""}`} />
                  Refresh fields
                </button>
              </div>
              <div className="space-y-1.5">
                {sources.map((s) => {
                  const mapped = value?.mapping?.[s.key];
                  const warn = mappingWarning(s.key, mapped);
                  return (
                    <div key={s.key} className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <div className="min-w-[9rem] flex-1">
                          <span className="text-ink-700 dark:text-ink-200">{s.label}</span>
                          {s.hint && <span className="ml-1 text-xs text-ink-400">({s.hint})</span>}
                        </div>
                        <span className="text-ink-400">→</span>
                        <SearchableSelect
                          className="w-auto min-w-[11rem] flex-1"
                          value={mapped ?? ""}
                          onChange={(v) => setMapping(s.key, v)}
                          options={mappingOptions}
                          emptyOptionLabel="Don't sync"
                          placeholder="Don't sync"
                          searchPlaceholder="Search fields…"
                          ariaLabel={`Field for ${s.label}`}
                        />
                      </div>
                      {warn && (
                        <p className="flex items-start gap-1 pl-1 text-xs text-amber-600 dark:text-amber-300">
                          <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                          <span>{warn}</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-ink-400">
                Only the rows you map are written. Computed fields (formulas, rollups, etc.) and
                attachment fields are hidden here — Airtable can&apos;t accept a plain value for those.
              </p>
            </div>
          ) : (
            value?.baseId && <p className="text-xs text-ink-400">Choose a table to map fields.</p>
          )}

          {/* Static values */}
          {selectedTable && (
            <div className="space-y-2">
              <span className="label block">
                Constant values <span className="font-normal text-ink-400">(optional)</span>
              </span>
              {(value?.staticValues ?? []).map((sv, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 text-sm">
                  <SearchableSelect
                    className="w-auto min-w-[9rem]"
                    value={sv.field}
                    onChange={(v) => updateStatic(idx, { field: v })}
                    options={mappingOptions}
                    placeholder="Choose field…"
                    searchPlaceholder="Search fields…"
                    ariaLabel="Constant field"
                  />
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
                  onChange={(e) =>
                    update({
                      attachFiles: e.target.checked,
                      attachFieldName: e.target.checked ? value?.attachFieldName ?? null : null,
                    })
                  }
                />
                <span>
                  Also attach the file(s) to an attachment field
                  <span className="block text-xs text-ink-400">
                    Google Drive only. Each file streams to Airtable through a private, expiring link
                    (it stays private in your Drive). Files over 100&nbsp;MB keep just the link
                    (recommended for large videos).
                  </span>
                </span>
              </label>
              {value?.attachFiles && (
                <>
                  {attachmentFields.length > 0 ? (
                    <SearchableSelect
                      value={value?.attachFieldName ?? ""}
                      onChange={(v) => update({ attachFieldName: v || null })}
                      options={attachmentOptions}
                      placeholder="Choose an attachment field…"
                      searchPlaceholder="Search fields…"
                      ariaLabel="Attachment field"
                    />
                  ) : (
                    <p className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-900/40">
                      This table has no attachment field. Add one in Airtable, then click{" "}
                      <strong>Refresh fields</strong> above.
                    </p>
                  )}
                  {!perBatch && (
                    <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-300">
                      <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>
                        Per-file mode creates a separate record (and attachment) for each file. To
                        collect all files from one submission into a single attachment field, switch to{" "}
                        <strong>Per submission</strong> above.
                      </span>
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Record personalization */}
          {selectedTable && (
            <div className="space-y-2 border-t border-ink-100 pt-3 dark:border-ink-800">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(value?.allowRecordPrefill)}
                  onChange={(e) => update({ allowRecordPrefill: e.target.checked })}
                />
                <span>
                  Personalize from an Airtable record
                  <span className="block text-xs text-ink-400">
                    Add{" "}
                    <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?record=recXXXXXXXX</code>{" "}
                    to the link URL — that record&apos;s columns fill merge tags (e.g.{" "}
                    <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">{"{{Address}}"}</code>) and
                    prefill any field whose label matches a column (hide those fields to keep them
                    unchanged). Requires the token&apos;s{" "}
                    <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">data.records:read</code>{" "}
                    scope.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(value?.updateRecordWhenPresent)}
                  onChange={(e) => update({ updateRecordWhenPresent: e.target.checked })}
                />
                <span>
                  Update that record on submit (two-way sync)
                  <span className="block text-xs text-ink-400">
                    When the link is opened with{" "}
                    <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?record=recXXX</code>, the
                    submission updates that record instead of creating a new one (a submission with no
                    record id still creates a new record). Mapped columns are overwritten with the new
                    answers; needs the token&apos;s{" "}
                    <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">data.records:write</code>{" "}
                    scope (already required).
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* Record sources — pull live data from other tables in this base */}
          {value?.baseId && (
            <div className="space-y-2 border-t border-ink-100 pt-3 dark:border-ink-800">
              <span className="label block">
                Connected tables <span className="font-normal text-ink-400">(optional)</span>
              </span>
              <p className="text-xs text-ink-400">
                Connect other tables in this base, then point the link URL at a record from each
                (e.g. <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?cleaner=recXXX</code>).
                <strong className="font-medium"> Every field</strong> of a connected record is then
                available — live in headings &amp; text as{" "}
                <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">{"{{cleaner.Name}}"}</code>{" "}
                and in the field mapping below — no waiting for the new row&apos;s lookups.
              </p>

              {/* Summary: which tables are connected & available right now. */}
              {recordSources.some((s) => s.tableId && s.alias.trim()) && (
                <div className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs dark:border-ink-700 dark:bg-ink-900/40">
                  <span className="font-medium text-ink-600 dark:text-ink-300">Available now:</span>
                  <ul className="mt-1 space-y-0.5">
                    {recordSources
                      .filter((s) => s.tableId && s.alias.trim())
                      .map((s) => (
                        <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-ink-700 dark:text-ink-200">
                            {(value?.baseName || "Base") + " — " + (s.tableName || "table")}
                          </span>
                          <code className="rounded bg-ink-100 px-1 text-ink-500 dark:bg-ink-900">
                            {`?${prefillKey(s.alias)}=recXXX`}
                          </code>
                          <span className="text-ink-400">→ {`{{${prefillKey(s.alias)}.Field}}`}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {recordSources.map((src) => {
                const srcTable = tables.find((t) => t.id === src.tableId) ?? null;
                const aliasKey = prefillKey(src.alias || "");
                const previewFields = (srcTable?.fields ?? []).slice(0, 8);
                return (
                  <div
                    key={src.id}
                    className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="label mb-1 block text-xs">Table</label>
                        <SearchableSelect
                          value={src.tableId}
                          onChange={(v) => pickSourceTable(src.id, v)}
                          options={tableOptions}
                          loading={loadingTables}
                          placeholder="Choose a table…"
                          searchPlaceholder="Search tables…"
                          ariaLabel="Source table"
                        />
                      </div>
                      <div>
                        <label className="label mb-1 block text-xs">Alias (URL key)</label>
                        <input
                          className="input"
                          value={src.alias}
                          onChange={(e) => updateSource(src.id, { alias: e.target.value })}
                          placeholder="e.g. cleaner"
                          maxLength={60}
                        />
                      </div>
                    </div>

                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={src.visible}
                        onChange={(e) => updateSource(src.id, { visible: e.target.checked })}
                      />
                      <span>
                        Let the uploader pick this record
                        <span className="block text-xs text-ink-400">
                          Off = prefilled from the link URL (hidden from the uploader). On = the
                          uploader searches and selects it — coming in a later update; URL prefill works
                          today.
                        </span>
                      </span>
                    </label>

                    {aliasKey && srcTable && (
                      <div className="rounded-md bg-ink-50 px-2 py-1.5 text-xs text-ink-500 dark:bg-ink-900/40">
                        <span className="block">
                          Link URL:{" "}
                          <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">{`?${aliasKey}=recXXXXXXXX`}</code>
                        </span>
                        <span className="mt-1 block">
                          Use any field as a tag —{" "}
                          {previewFields.map((f) => (
                            <code
                              key={f.id}
                              className="mr-1 rounded bg-ink-100 px-1 dark:bg-ink-900"
                            >{`{{${aliasKey}.${f.name}}}`}</code>
                          ))}
                          {(srcTable.fields.length > previewFields.length) && (
                            <span>…and {srcTable.fields.length - previewFields.length} more</span>
                          )}
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => removeSource(src.id)}
                      className="text-xs text-red-600 hover:underline dark:text-red-300"
                    >
                      Remove source
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addSource}
                className="text-xs font-medium text-brand hover:underline"
              >
                + Connect a table
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
