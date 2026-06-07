/**
 * Dashboard index — the upload-link list.
 *
 * States:
 *   - Env not configured → amber admin banner, disabled empty state.
 *   - No connection yet → prompt to connect (links to Settings).
 *   - No links yet → empty state with "Create your first link".
 *   - Has links → the real list (LinkList).
 *
 * Connection count + link list loads are wrapped so a transient DB hiccup
 * degrades to a banner instead of 500-ing the page.
 */
import Link from "next/link";
import { Link2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Topbar } from "@/components/topbar";
import { LinkList } from "@/components/link-list";
import { requireUser } from "@/lib/auth";
import { isGoogleConfigured, publicEnv } from "@/lib/env";
import { countUserActiveConnections } from "@/lib/connections";
import { listLinksWithStats, type UploadLinkWithStats } from "@/lib/links";
import { listProjects, type ProjectSummary } from "@/lib/projects";

export default async function DashboardPage() {
  const user = await requireUser();
  const anyProviderEnvReady = isGoogleConfigured();

  let userConnectionCount = 0;
  let links: UploadLinkWithStats[] = [];
  let loadFailed = false;

  if (anyProviderEnvReady) {
    try {
      [userConnectionCount, links] = await Promise.all([
        countUserActiveConnections(user.id),
        listLinksWithStats(user.id),
      ]);
    } catch (err) {
      loadFailed = true;
      // eslint-disable-next-line no-console
      console.error("[dashboard] load failed:", err);
    }
  }

  let projects: ProjectSummary[] = [];
  if (anyProviderEnvReady && !loadFailed) {
    try {
      projects = await listProjects(user.id);
    } catch {
      /* non-fatal — show links without project filter */
    }
  }

  const hasConnection = userConnectionCount > 0;
  const hasLinks = links.length > 0;
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;

  return (
    <>
      <Topbar email={user.email} title="Upload Links" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-5xl">
          {loadFailed && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              We couldn&apos;t load your data just now. This is usually temporary —
              refresh in a moment.
            </div>
          )}

          {!anyProviderEnvReady && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
              No storage providers are configured on this deployment yet.
            </div>
          )}

          {anyProviderEnvReady && !loadFailed && !hasConnection && (
            <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-900/40 dark:bg-brand-900/20 dark:text-brand-100">
              <span>Connect a storage provider to create your first upload link.</span>
              <Link href="/settings" className="btn-primary h-8 text-xs">Go to Settings</Link>
            </div>
          )}

          {/* Main content */}
          {hasLinks ? (
            <LinkList links={links} appUrl={appUrl} projects={projects} />
          ) : (
            <EmptyState
              icon={Link2}
              title="No upload links yet"
              description="Upload links let your guests, cleaners, or owners send files straight into a storage folder. Create your first one to get started."
              action={
                hasConnection
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
          )}
        </div>
      </main>
    </>
  );
}
