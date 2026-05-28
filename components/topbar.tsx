/**
 * Top bar for the dashboard. Shows the page title on the left, the
 * signed-in user's email + a logout form on the right.
 *
 * Logout is a POST to /api/auth/logout (form action). This keeps the
 * signed-out redirect server-driven and avoids any client JS pitfalls
 * around clearing cookies.
 */
import { LogOut } from "lucide-react";

interface TopbarProps {
  email: string | null | undefined;
  title?: string;
}

export function Topbar({ email, title }: TopbarProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-ink-200 bg-white px-6 dark:border-ink-700 dark:bg-ink-950">
      <h1 className="font-display text-base font-semibold text-ink-900 dark:text-ink-50">
        {title ?? ""}
      </h1>
      <div className="flex items-center gap-3">
        {email && (
          <span className="hidden text-sm text-ink-500 sm:inline">{email}</span>
        )}
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="btn-ghost h-8 px-2 text-xs"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Log out</span>
          </button>
        </form>
      </div>
    </header>
  );
}
