"use client";

/**
 * Airtable Mapping — the DESTINATION half of Airtable.
 *
 * Optional: when enabled, the form creates/updates a record in one table of the
 * base chosen in Connected Data. Owns the destination table, record mode, the
 * destination-oriented field mapping (each table field filled from any value
 * source — upload context, custom fields, or any connected table's fields),
 * constant values, attachments, and two-way sync. The base + connected tables
 * live in Connected Data; this section shares the same AirtableConfig + schema.
 */
import { Table2, AlertCircle, RefreshCw } from "lucide-react";
import { SearchableSelect, type SelectOption } from "@/components/searchable-select";
import {
  DEFAULT_CONFIG,
  prettyType,
  READONLY_TYPES,
  ATTACHMENT_TYPE,
  SINGLE_FORMAT_TYPES,
  MULTI_VALUE_SOURCES,
  type AirtableSchema,
} from "@/components/airtable-schema";
import {
  AIRTABLE_BUILTIN_SOURCES,
  customFieldSourceKey,
  recordSourceLinkKey,
  recordSourceValueKey,
  getFieldMappings,
} from "@/lib/airtable/sources";
import { prefillKey } from "@/lib/filename";
import type { AirtableConfig, CustomFieldDef } from "@/lib/db-types";

interface AirtableMappingEditorProps {
  connected: boolean;
  value: AirtableConfig | null;
  onChange: (cfg: AirtableConfig | null) => void;
  customFields: CustomFieldDef[];
  schema: AirtableSchema;
}

export function AirtableMappingEditor({
  connected,
  value,
  onChange,
  customFields,
  schema,
}: AirtableMappingEditorProps) {
  const { tables, loadingTables, fetchError, loadTables } = schema;
  const enabled = Boolean(value?.enabled);
  const perBatch = value?.recordMode === "per_batch";
  const baseId = value?.baseId ?? "";

  function update(patch: Partial<AirtableConfig>) {
    onChange({ ...(value ?? DEFAULT_CONFIG), ...patch });
  }

  function pickTable(tableId: string) {
    const t = tables.find((x) => x.id === tableId);
    update({ tableId, tableName: t?.name ?? "", mapping: {}, fieldMappings: [], attachFieldName: null });
  }

  function fieldMappingFor(destField: string): string {
    return getFieldMappings(value ?? { mapping: {} }).find((m) => m.field === destField)?.source ?? "";
  }
  function setFieldMapping(destField: string, sourceKey: string) {
    const next = getFieldMappings(value ?? { mapping: {} }).filter((m) => m.field !== destField);
    if (sourceKey) next.push({ field: destField, source: sourceKey });
    update({ fieldMappings: next });
  }

  function addStatic() {
    update({ staticValues: [...(value?.staticValues ?? []), { field: "", value: "" }] });
  }
  function updateStatic(idx: number, patch: Partial<{ field: string; value: string }>) {
    update({ staticValues: (value?.staticValues ?? []).map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  }
  function removeStatic(idx: number) {
    update({ staticValues: (value?.staticValues ?? []).filter((_, i) => i !== idx) });
  }

  const recordSources = value?.recordSources ?? [];
  const selectedTable = tables.find((t) => t.id === value?.tableId) ?? null;
  const mappingFields = selectedTable
    ? selectedTable.fields.filter((f) => !READONLY_TYPES.has(f.type) && f.type !== ATTACHMENT_TYPE)
    : [];
  const attachmentFields = selectedTable ? selectedTable.fields.filter((f) => f.type === ATTACHMENT_TYPE) : [];

  const tableOptions: SelectOption[] = (() => {
    const opts = tables.map((t) => ({ value: t.id, label: t.name }));
    if (value?.tableId && !opts.some((o) => o.value === value.tableId)) {
      opts.unshift({ value: value.tableId, label: value.tableName || value.tableId });
    }
    return opts;
  })();

  const mappingOptions: SelectOption[] = mappingFields.map((f) => ({
    value: f.name,
    label: f.name,
    hint: prettyType(f.type),
  }));
  const attachmentOptions: SelectOption[] = attachmentFields.map((f) => ({ value: f.name, label: f.name }));

  // Value sources offered for each destination field: upload context, custom
  // fields, the record links, and every field of every connected table.
  const sources = [
    ...AIRTABLE_BUILTIN_SOURCES.map((s) => ({ key: s.key, label: s.label, hint: s.hint })),
    ...customFields
      .filter((f) => f.label.trim())
      .map((f) => ({ key: customFieldSourceKey(f.label.trim()), label: f.label.trim(), hint: "Custom field" })),
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
  const valueSourceOptions: SelectOption[] = sources.map((s) => ({ value: s.key, label: s.label, hint: s.hint }));

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
          Connect your Airtable account in <strong>Settings → Airtable</strong> to create records.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        <Table2 className="h-4 w-4 text-ink-500" />
        Create an Airtable record on every submission
      </label>

      {enabled && !baseId && (
        <p className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-900/40">
          Pick your Airtable <strong>base</strong> in the <strong>Connected data</strong> section above,
          then choose which table to write to here.
        </p>
      )}

      {enabled && baseId && (
        <div className="space-y-4 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          {/* Destination table */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="label">Write the record to</label>
              <button
                type="button"
                onClick={() => baseId && void loadTables(baseId)}
                disabled={loadingTables}
                className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800 disabled:opacity-50 dark:hover:text-ink-200"
              >
                <RefreshCw className={`h-3 w-3 ${loadingTables ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            <SearchableSelect
              value={value?.tableId ?? ""}
              onChange={pickTable}
              options={tableOptions}
              loading={loadingTables}
              placeholder="Choose a table…"
              searchPlaceholder="Search tables…"
              ariaLabel="Destination table"
            />
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

          {/* Field mapping — destination-oriented */}
          {selectedTable ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="label">Fill {selectedTable.name} fields</span>
                <button
                  type="button"
                  onClick={() => baseId && void loadTables(baseId)}
                  disabled={loadingTables}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingTables ? "animate-spin" : ""}`} />
                  Refresh fields
                </button>
              </div>
              <p className="text-xs text-ink-400">
                These are the fields on <strong>{selectedTable.name}</strong> — the only table the record
                is written to. Fill each from any value: the upload, a custom field, or any field of a
                connected table.
              </p>
              <div className="space-y-1.5">
                {mappingFields.length === 0 && (
                  <p className="text-xs text-ink-400">This table has no writable fields.</p>
                )}
                {mappingFields.map((destField) => {
                  const selected = fieldMappingFor(destField.name);
                  const warn = mappingWarning(selected, destField.name);
                  return (
                    <div key={destField.id} className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <div className="min-w-[9rem] flex-1">
                          <span className="text-ink-700 dark:text-ink-200">{destField.name}</span>
                          <span className="ml-1 text-xs text-ink-400">({prettyType(destField.type)})</span>
                        </div>
                        <span className="text-ink-400">←</span>
                        <SearchableSelect
                          className="w-auto min-w-[11rem] flex-1"
                          value={selected}
                          onChange={(v) => setFieldMapping(destField.name, v)}
                          options={valueSourceOptions}
                          emptyOptionLabel="Leave blank"
                          placeholder="Leave blank"
                          searchPlaceholder="Search values…"
                          ariaLabel={`Value for ${destField.name}`}
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
                Only fields you fill are written. Computed fields (formulas, rollups, etc.) and attachment
                fields aren&apos;t shown — Airtable can&apos;t accept a plain value for those.
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink-400">Choose a table to map fields.</p>
          )}

          {/* Constant values */}
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
              <button type="button" onClick={addStatic} className="text-xs font-medium text-brand hover:underline">
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
                    Google Drive only. Each file streams to Airtable through a private, expiring link (it
                    stays private in your Drive). Files over 100&nbsp;MB keep just the link (recommended
                    for large videos).
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
                        Per-file mode creates a separate record (and attachment) for each file. To collect
                        all files from one submission into a single attachment field, switch to{" "}
                        <strong>Per submission</strong> above.
                      </span>
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Two-way sync (record personalization for the destination record) */}
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
                  Personalize from the destination record
                  <span className="block text-xs text-ink-400">
                    Add{" "}
                    <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?record=recXXXXXXXX</code> to
                    the link URL — that record&apos;s columns fill merge tags and prefill any field whose
                    label matches a column. Requires the token&apos;s{" "}
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
                    When opened with{" "}
                    <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?record=recXXX</code>, the
                    submission updates that record instead of creating a new one (no record id still
                    creates a new record). Needs the token&apos;s{" "}
                    <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">data.records:write</code>{" "}
                    scope.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
