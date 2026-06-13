"use client";

/**
 * A connected-table merge-tag chip that opens a searchable field list, so the
 * owner picks the exact field instead of typing it. On pick it inserts
 * `{{aliasKey.Field Name}}`. Falls back to inserting `{{aliasKey.}}` (cursor-
 * ready) when the table's schema hasn't loaded yet.
 */
import { useEffect, useRef, useState } from "react";

interface TokenFieldPickerProps {
  aliasKey: string;
  fields: string[];
  onInsert: (token: string) => void;
}

export function TokenFieldPicker({ aliasKey, fields, onInsert }: TokenFieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? fields.filter((f) => f.toLowerCase().includes(needle)) : fields;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          if (fields.length === 0) {
            onInsert(`{{${aliasKey}.}}`);
            return;
          }
          setOpen((v) => !v);
        }}
        title={`Insert a field from ${aliasKey}`}
        className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
      >
        {`{{${aliasKey}.…}}`}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-60 rounded-lg border border-ink-200 bg-white p-2 shadow-lg dark:border-ink-700 dark:bg-ink-900">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${aliasKey} fields…`}
            className="input mb-1 h-8 text-xs"
          />
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-1 text-xs text-ink-400">No matching fields.</p>
            ) : (
              filtered.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    onInsert(`{{${aliasKey}.${f}}}`);
                    setOpen(false);
                    setQ("");
                  }}
                  className="block w-full truncate rounded px-2 py-1 text-left text-xs text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  {f}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
