"use client";

/**
 * A collapsible "accordion" section with a clickable header (title + optional
 * Pro badge + chevron). Used to tame long forms (link creator, settings) so
 * people can scan headings and expand only what they need. Renders its own
 * title/description, so callers pass just the body as children.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function CollapsibleSection({
  title,
  badge,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-900/50"
      >
        <span className="flex items-center gap-2">
          <span className="font-display text-base font-semibold">{title}</span>
          {badge && (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100">
              {badge}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-4 border-t border-ink-100 px-4 pb-4 pt-4 dark:border-ink-800">
          {description && <p className="-mt-0.5 text-sm text-ink-500">{description}</p>}
          {children}
        </div>
      )}
    </div>
  );
}
