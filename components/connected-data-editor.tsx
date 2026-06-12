"use client";

/**
 * Connected Data — the SOURCE half of Airtable, elevated to a first-class
 * "submission context" section near the top of the builder.
 *
 * Owns the Airtable connection + base picker and the connected tables (record
 * sources). Records referenced here (by URL alias, e.g. ?cleaner=recXXX) power
 * merge tags, file naming, hidden-field prefills, mapping, routing, and
 * notifications — independent of whether the form also creates a record (that's
 * the downstream Airtable Mapping section). Shares one AirtableConfig + schema
 * with that section via the parent.
 */
import { AlertCircle, RefreshCw, Database } from "lucide-react";
import { SearchableSelect, type SelectOption } from "@/components/searchable-select";
import { DEFAULT_CONFIG, type AirtableSchema } from "@/components/airtable-schema";
import { prefillKey } from "@/lib/filename";
import type { AirtableConfig, RecordSource } from "@/lib/db-types";

interface ConnectedDataEditorProps {
  connected: boolean;
  value: AirtableConfig | null;
  onChange: (cfg: AirtableConfig | null) => void;
  schema: AirtableSchema;
}

export function ConnectedDataEditor({ connected, value, onChange, schema }: ConnectedDataEditorProps) {
  const { bases, tables, loadingBases, loadingTables, fetchError, loadBases, loadTables, resetTables } = schema;

  function update(patch: Partial<AirtableConfig>) {
    onChange({ ...(value ?? DEFAULT_CONFIG), ...patch });
  }

  function pickBase(baseId: string) {
    const b = bases.find((x) => x.id === baseId);
    // The base scopes everything downstream — switching it invalidates the
    // destination table, mappings, and connected tables (all base-specific).
    update({
      baseId,
      baseName: b?.name ?? "",
      tableId: "",
      tableName: "",
      mapping: {},
      fieldMappings: [],
      attachFieldName: null,
      recordSources: [],
    });
    resetTables();
    if (baseId) void loadTables(baseId);
  }

  // --- Connected tables (record sources) ------------------------------------
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
    const src = recordSources.find((s) => s.id === id);
    const patch: Partial<RecordSource> = { tableId, tableName: t?.name ?? "" };
    // Auto-suggest an alias from the table name when the user hasn't set one
    // (deduped against other sources). Editable afterward.
    if (t && !src?.alias.trim()) {
      const base = prefillKey(t.name) || "table";
      const taken = new Set(recordSources.filter((s) => s.id !== id).map((s) => prefillKey(s.alias)));
      let alias = base;
      let n = 2;
      while (taken.has(alias)) alias = `${base}_${n++}`;
      patch.alias = alias;
    }
    updateSource(id, patch);
  }

  const baseOptions: SelectOption[] = (() => {
    const opts = bases.map((b) => ({ value: b.id, label: b.name }));
    if (value?.baseId && !opts.some((o) => o.value === value.baseId)) {
      opts.unshift({ value: value.baseId, label: value.baseName || value.baseId });
    }
    return opts;
  })();

  const tableOptions: SelectOption[] = (() => {
    const opts = tables.map((t) => ({ value: t.id, label: t.name }));
    return opts;
  })();

  if (!connected) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          Connect your Airtable account in <strong>Settings → Airtable</strong> to pull data from your
          tables (and, optionally, create records).
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Pick the Airtable base this form works with, then connect the tables whose records it should
        know about. Reference a record per table from the link URL (e.g.{" "}
        <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?cleaner=recXXX</code>) and every field
        of that record becomes available throughout the form — merge tags, file naming, mapping,
        routing, and notifications.
      </p>

      {/* Base */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="label flex items-center gap-1.5">
            <Database className="h-4 w-4 text-ink-500" />
            Base
          </label>
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

      {fetchError && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{fetchError}</span>
        </div>
      )}

      {/* Connected tables */}
      {value?.baseId && (
        <div className="space-y-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <span className="label block">
            Connected tables <span className="font-normal text-ink-400">(optional)</span>
          </span>

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
              <div key={src.id} className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
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
                      Off = prefilled from the link URL (hidden from the uploader). On = the uploader
                      searches and selects it — coming in a later update; URL prefill works today.
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
                      {srcTable.fields.length > previewFields.length && (
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
                  Remove table
                </button>
              </div>
            );
          })}

          <button type="button" onClick={addSource} className="text-xs font-medium text-brand hover:underline">
            + Connect a table
          </button>
        </div>
      )}
    </div>
  );
}
