"use client";

/**
 * Shared Airtable schema loader + field-type helpers for the link builder.
 *
 * Connected Data (the source section) and Airtable Mapping (the destination
 * section) both need the same base list and the same table/field schema. This
 * hook is called once in the parent (link-form) and passed to both, so the
 * bases/tables are fetched a single time and stay in sync.
 */
import { useCallback, useEffect, useState } from "react";
import type { AirtableConfig } from "@/lib/db-types";

export interface ApiBase {
  id: string;
  name: string;
}
export interface ApiField {
  id: string;
  name: string;
  type: string;
  /** Choice names for singleSelect / multipleSelects fields (else absent). */
  options?: string[];
}
export interface ApiTable {
  id: string;
  name: string;
  fields: ApiField[];
}

// Field types we can't write a plain value into (computed / system fields).
export const READONLY_TYPES = new Set([
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
export const ATTACHMENT_TYPE = "multipleAttachments";

// Single-value formatted fields that can't hold several newline-joined values.
export const SINGLE_FORMAT_TYPES = new Set(["url", "email", "phoneNumber"]);
// Sources that can produce several values (one per file) in per-submission mode.
export const MULTI_VALUE_SOURCES = new Set(["link", "filename", "filetype"]);

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
export function prettyType(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

/**
 * Base config seed. enabled defaults to FALSE: connecting a base / tables in
 * Connected Data no longer implies record creation — that's an explicit opt-in
 * in the Airtable Mapping (destination) section.
 */
export const DEFAULT_CONFIG: AirtableConfig = {
  enabled: false,
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

export interface AirtableSchema {
  bases: ApiBase[];
  tables: ApiTable[];
  loadingBases: boolean;
  loadingTables: boolean;
  fetchError: string | null;
  loadBases: () => Promise<void>;
  loadTables: (baseId: string) => Promise<void>;
  resetTables: () => void;
}

/**
 * Load the user's Airtable bases (when connected) and the tables/fields of the
 * selected base. Bases load lazily once connected; tables hydrate when a base
 * is set. Switching bases should call resetTables() then loadTables(newBase).
 */
export function useAirtableSchema(connected: boolean, baseId: string | undefined): AirtableSchema {
  const [bases, setBases] = useState<ApiBase[]>([]);
  const [tables, setTables] = useState<ApiTable[]>([]);
  const [loadingBases, setLoadingBases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

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

  const loadTables = useCallback(async (id: string) => {
    setLoadingTables(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/airtable/tables?baseId=${encodeURIComponent(id)}`);
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

  const resetTables = useCallback(() => setTables([]), []);

  // Bases load once connected (independent of record creation now).
  useEffect(() => {
    if (connected && bases.length === 0 && !loadingBases) void loadBases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);
  // Tables hydrate for the selected base (edit mode / after Connected Data set it).
  useEffect(() => {
    if (connected && baseId && tables.length === 0 && !loadingTables) void loadTables(baseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, baseId]);

  return { bases, tables, loadingBases, loadingTables, fetchError, loadBases, loadTables, resetTables };
}
