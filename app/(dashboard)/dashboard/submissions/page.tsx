/**
 * Submissions inbox — every submission across all of the user's links, newest
 * first. This is where the "submission infrastructure" repositioning becomes
 * visible: one place to see what came in, regardless of which link or
 * destination it used. Filter by link / project / search; click through for the
 * full detail + delivery log.
 */
import Link from "next/link";
import { Inbox, ChevronRight, FileUp } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { SubmissionsFilters } from "@/components/submissions-filters";
import { requireUser } from "@/lib/auth";
import { listSubmissions, type SubmissionListItem } from "@/lib/submissions";
import { listLinksWithStats } from "@/lib/links";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { link?: string; project?: string; q?: string };
}

export default async function SubmissionsPage({ searchParams }: PageProps) {
  const user = await requireUser();

  let submissions: SubmissionListItem[] = [];
  let loadError = false;
  try {
    submissions = await listSubmissions(user.id, {
      linkId: searchParams.link,
      projectId: searchParams.project,
      search: searchParams.q,
    });
  } catch {
    loadError = true;
  }

  let links: { id: string; name: string }[] = [];
  let projects: { id: string; name: string }[] = [];
  try {
    const [l, p] = await Promise.all([listLinksWithStats(user.id), listProjects(user.id)]);
    links = l.map((x) => ({ id: x.id, name: x.name }));
    projects = p.map((x) => ({ id: x.id, name: x.name }));
  } catch {
    /* non-fatal — filters just won't populate */
  }

  const hasFilters = Boolean(searchParams.link || searchParams.project || searchParams.q);

  return (
    <>
      <Topbar email={user.email} title="Submissions" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6">
            <h2 className="font-display text-xl font-semibold">Submissions</h2>
            <p className="mt-1 text-sm text-ink-500">
              Everything collected across your links — files, form answers, and where each was routed.
            </p>
          </div>

          <SubmissionsFilters
            links={links}
            projects={projects}
            current={{ link: searchParams.link, project: searchParams.project, q: searchParams.q }}
          />

          {loadError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              Couldn&apos;t load submissions just now — refresh in a moment.
            </div>
          )}

          {submissions.length === 0 && !loadError ? (
            <div className="card flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-100">
                {hasFilters ? <FileUp className="h-6 w-6" /> : <Inbox className="h-6 w-6" />}
              </div>
              <h3 className="mb-1 font-display text-lg font-semibold">
                {hasFilters ? "No matching submissions" : "No submissions yet"}
              </h3>
              <p className="max-w-md text-sm text-ink-500">
                {hasFilters
                  ? "Try clearing the filters or search."
                  : "When someone submits through one of your links, it shows up here."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {submissions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/dashboard/submissions/${s.id}`}
                    className="card flex items-center gap-4 transition-colors hover:border-brand-300 dark:hover:border-brand-700"
                  >
                    <StatusBadge status={s.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="truncate font-medium">
                          {s.uploaderName || s.uploaderEmail || "Anonymous"}
                        </span>
                        <span className="text-xs text-ink-400">· {s.linkName}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-400">
                        <span>
                          {s.fileCount} {s.fileCount === 1 ? "file" : "files"}
                        </span>
                        {s.uploaderMessage && (
                          <span className="truncate italic">“{s.uploaderMessage}”</span>
                        )}
                        <span className="ml-auto whitespace-nowrap">{formatDateTime(s.createdAt)}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}

function StatusBadge({ status }: { status: SubmissionListItem["status"] }) {
  const map: Record<SubmissionListItem["status"], { label: string; cls: string }> = {
    new: { label: "New", cls: "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100" },
    in_progress: { label: "In progress", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100" },
    done: { label: "Done", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100" },
    archived: { label: "Archived", cls: "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400" },
  };
  const s = map[status];
  return (
    <span className={`flex-shrink-0 rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
