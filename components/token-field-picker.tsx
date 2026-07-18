"use client";

/**
 * A connected-table merge-tag chip that opens a searchable field list, so the
 * owner picks the exact field instead of typing it. On pick it inserts
 * `{{aliasKey.Field Name}}`. Falls back to inserting `{{aliasKey.}}` (cursor-
 * ready) when the table's schema hasn't loaded yet.
 *
 * The menu is rendered in a portal with fixed positioning so it floats above
 * the form instead of being clipped by the surrounding card's overflow (which
 * previously hid the lower fields entirely). It flips above the chip when there
 * isn't room below.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface TokenFieldPickerProps {
  aliasKey: string;
  fields: string[];
  onInsert: (token: string) => void;
}

const MENU_WIDTH = 240; // px — matches the old w-60
const MENU_MAX_HEIGHT = 260; // px — input + scroll area + padding
const GAP = 4; // px between chip and menu

interface MenuPos {
  left: number;
  top: number;
  maxHeight: number;
}

export function TokenFieldPicker({ aliasKey, fields, onInsert }: TokenFieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<MenuPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the floating menu relative to the chip, flipping above when there
  // isn't enough room below. Runs on open and on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - GAP;
      const spaceAbove = rect.top - GAP;
      const flipUp = spaceBelow < Math.min(MENU_MAX_HEIGHT, 160) && spaceAbove > spaceBelow;
      const maxHeight = Math.min(MENU_MAX_HEIGHT, (flipUp ? spaceAbove : spaceBelow));
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8),
      );
      const top = flipUp ? rect.top - GAP - maxHeight : rect.bottom + GAP;
      setPos({ left, top, maxHeight });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Close on outside click (covers both the chip and the portalled menu) + Esc.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? fields.filter((f) => f.toLowerCase().includes(needle)) : fields;

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
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
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              width: MENU_WIDTH,
              maxHeight: pos?.maxHeight ?? MENU_MAX_HEIGHT,
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-50 flex flex-col overflow-hidden rounded-lg border border-ink-200 bg-white p-2 shadow-xl dark:border-ink-700 dark:bg-ink-900"
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${aliasKey} fields…`}
              className="input mb-1 h-8 flex-shrink-0 text-xs"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-1 text-xs text-ink-400">No matching fields.</p>
              ) : (
                filtered.map((f) => (
                  <button
                    key={f}
                    type="button"
                    title={f}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
