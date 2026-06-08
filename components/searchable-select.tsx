"use client";

/**
 * SearchableSelect — a filterable single-select combobox.
 *
 * Built for Airtable pickers where a base/table can have hundreds of entries.
 * The options panel expands INLINE (not as an absolute overlay) so it's never
 * clipped by the surrounding CollapsibleSection's overflow-hidden, and it works
 * fine inside long scrolling forms.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Label for a top "clear" row that sets value back to "". Omit to hide it. */
  emptyOptionLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  searchPlaceholder?: string;
  className?: string;
  ariaLabel?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  emptyOptionLabel,
  disabled = false,
  loading = false,
  searchPlaceholder = "Search…",
  className = "",
  ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="input flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`truncate ${selected ? "" : "text-ink-400"}`}>
          {loading ? "Loading…" : selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-1 rounded-lg border border-ink-200 bg-white shadow-sm dark:border-ink-700 dark:bg-ink-950">
          <div className="flex items-center gap-2 border-b border-ink-100 px-2.5 py-2 dark:border-ink-800">
            <Search className="h-4 w-4 flex-shrink-0 text-ink-400" />
            <input
              autoFocus
              className="w-full bg-transparent text-sm outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length > 0) choose(filtered[0].value);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder={searchPlaceholder}
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {emptyOptionLabel && (
              <li>
                <button
                  type="button"
                  onClick={() => choose("")}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-900"
                >
                  {emptyOptionLabel}
                  {value === "" && <Check className="h-3.5 w-3.5 text-brand" />}
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-400">No matches.</li>
            ) : (
              filtered.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => choose(o.value)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-900"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block truncate text-xs text-ink-400">{o.hint}</span>}
                    </span>
                    {o.value === value && <Check className="h-3.5 w-3.5 flex-shrink-0 text-brand" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
