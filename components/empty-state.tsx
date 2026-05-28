/**
 * Reusable empty-state component for dashboard tables / lists.
 * Render with an icon, headline, supporting text, and an optional CTA.
 */
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?:
    | { kind: "link"; href: string; label: string }
    | { kind: "disabled"; label: string; reason: string };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="card flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-100">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 font-display text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-ink-500">{description}</p>
      {action?.kind === "link" && (
        <Link href={action.href} className="btn-primary mt-6">
          {action.label}
        </Link>
      )}
      {action?.kind === "disabled" && (
        <div className="mt-6 flex flex-col items-center gap-1">
          <button className="btn-secondary" disabled>
            {action.label}
          </button>
          <p className="text-xs text-ink-400">{action.reason}</p>
        </div>
      )}
    </div>
  );
}
