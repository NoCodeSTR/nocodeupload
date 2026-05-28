/**
 * Dashboard index. Shows the empty state for "no upload links yet"
 * (M6 will replace this with the real list view).
 *
 * Banner logic:
 *   - If NO provider is env-configured on this deployment → admin-level
 *     warning ("No storage providers are configured on this deployment").
 *   - Else if the user has no active connection → user-level prompt
 *     ("Connect a storage provider in Settings to create your first link").
 *   - Else → no banner.
 */
import Link from "next/link";
import { Link2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Topbar } from "@/components/topbar";
import { requireUser } from "@/lib/auth";
import { isGoogleConfigured } from "@/lib/env";
import { countUserActiveConnections } from "@/lib/connections";

export default async function DashboardPage() {
  const user = await requireUser();

  // Env-level readiness: do we have at least one provider configured on this deployment?
  const anyProviderEnvReady = isGoogleConfigured();

  // User-level readiness: does THIS user have any active connection?
  const userConnectionCount = anyProviderEnvReady
    ? await countUserActiveConnections(user.id)
    : 0;

  const canCreateLink = anyProviderEnvReady && userConnectionCount > 0;

  return (
    <>
      <Topbar email={user.email} title="Upload Links" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-5xl">
          {!anyProviderEnvReady && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
              No storage providers are configured on this deployment yet. You can
              sign in and browse the dashboard, but creating upload links requires
              connecting a storage provider first.
            </div>
          )}

          {anyProviderEnvReady && userConnectionCount === 0 && (
            <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-900/40 dark:bg-brand-900/20 dark:text-brand-100">
              <span>
                Connect a storage provider to create your first upload link.
              </span>
              <Link href="/settings" className="btn-primary h-8 text-xs">
                Go to Settings
              </Link>
            </div>
          )}

          <EmptyState
            icon={Link2}
            title="No upload links yet"
            description="Upload links let your guests, cleaners, or owners send files straight into a storage folder. Create your first one to get started."
            action={
              canCreateLink
                ? { kind: "link", href: "/dashboard/links/new", label: "Create your first link" }
                : {
                    kind: "disabled",
                    label: "Create upload link",
                    reason: anyProviderEnvReady
                      ? "Connect a storage provider first — see Settings."
                      : "Storage provider credentials aren't configured on this deployment.",
                  }
            }
          />
        </div>
      </main>
    </>
  );
}
