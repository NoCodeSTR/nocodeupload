"use client";

/**
 * Dashboard list of the user's upload links. Each row shows name, folder,
 * the public URL with a copy button, upload count, created date, and an
 * active/inactive badge. Inline actions: edit, activate/deactivate, delete.
 *
 * Mutations (toggle, delete) call the API then router.refresh() to re-pull
 * the server-rendered list.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Pencil, Trash2, FolderOpen, Folders, Code2, Copy, QrCode, ExternalLink, Search } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import type { UploadLinkWithStats } from "@/lib/links";
import type { ProjectSummary } from "@/lib/projects";
import type { TagSummary } from "@/lib/tags";

interface LinkListProps {
  links: UploadLinkWithStats[];
  appUrl: string;
  projects?: ProjectSummary[];
  allTags?: TagSummary[];
  tagsByLink?: Record<string, string[]>;
}

export function LinkList({ links, appUrl, projects = [], allTags = [], tagsByLink = {} }: LinkListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all"); // "all" | "none" | <projectId>
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const q = search.trim().toLowerCase();
  const linkTags = (id: string) => tagsByLink[id] ?? [];

  function toggleTag(name: string) {
    setSelectedTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  }

  const filtered = links.filter((l) => {
    if (projectFilter === "none" && l.project_id) return false;
    if (projectFilter !== "all" && projectFilter !== "none" && l.project_id !== projectFilter) return false;
    if (selectedTags.length) {
      const lt = linkTags(l.id).map((t) => t.toLowerCase());
      if (!selectedTags.some((s) => lt.includes(s.toLowerCase()))) return false;
    }
    if (q) {
      const hay = `${l.name} ${l.folder_name ?? ""} ${linkTags(l.id).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  function deleteSelectedProject() {
    if (projectFilter === "all" || projectFilter === "none") return;
    if (!window.confirm("Delete this project? Its links stay, just unassigned.")) return;
    startTransition(async () => {
      await fetch(`/api/projects/${projectFilter}`, { method: "DELETE" }).catch(() => {});
      setProjectFilter("all");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search links…"
            />
          </div>
          {projects.length > 0 && (
            <select
              className="input w-auto"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Filter by project"
            >
              <option value="all">All projects</option>
              <option value="none">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {projectFilter !== "all" && projectFilter !== "none" && (
            <button
              type="button"
              onClick={deleteSelectedProject}
              disabled={isPending}
              className="text-xs text-red-600 hover:underline dark:text-red-300"
            >
              Delete project
            </button>
          )}
        </div>
        <Link href="/dashboard/links/new" className="btn-primary h-9 flex-shrink-0 text-sm">
          New upload link
        </Link>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-400">Tags:</span>
          {allTags.map((t) => {
            const on = selectedTags.includes(t.name);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTag(t.name)}
                className={
                  on
                    ? "rounded-md border border-brand bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
                    : "rounded-md border border-ink-200 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-900"
                }
              >
                {t.name}
              </button>
            );
          })}
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className="text-xs text-ink-400 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <p className="text-sm text-ink-500">
        {filtered.length === links.length
          ? `${links.length} upload ${links.length === 1 ? "link" : "links"}`
          : `${filtered.length} of ${links.length} links`}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-200 py-10 text-center text-sm text-ink-500 dark:border-ink-700">
          No links match your search or filter.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              appUrl={appUrl}
              projectLabel={link.project_id ? projectName.get(link.project_id) ?? null : null}
              tagLabels={linkTags(link.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkRow({
  link,
  appUrl,
  projectLabel,
  tagLabels = [],
}: {
  link: UploadLinkWithStats;
  appUrl: string;
  projectLabel?: string | null;
  tagLabels?: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const publicUrl = `${appUrl}/u/${link.slug}`;

  const expired = link.expires_at ? new Date(link.expires_at).getTime() < Date.now() : false;

  function toggleActive() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !link.is_active }),
      });
      if (!res.ok) {
        setError("Couldn't update status.");
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${link.name}"? This also removes its upload history and can't be undone.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/links/${link.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't delete the link.");
        return;
      }
      router.refresh();
    });
  }

  function duplicate() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/links/${link.id}/duplicate`, { method: "POST" });
      if (!res.ok) {
        setError("Couldn't duplicate the link.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      // Land on the copy's edit page so the user can tweak it right away.
      if (body.id) router.push(`/dashboard/links/${body.id}/edit`);
      else router.refresh();
    });
  }

  return (
    <li className="card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 flex-shrink-0 text-brand" />
            <h3 className="truncate font-display text-base font-semibold">{link.name}</h3>
            <StatusBadge active={link.is_active} expired={expired} />
            {projectLabel && (
              <span className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                <Folders className="h-3 w-3" />
                {projectLabel}
              </span>
            )}
          </div>

          <div className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{link.folder_name ?? link.folder_id}</span>
          </div>

          {tagLabels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tagLabels.map((t) => (
                <span
                  key={t}
                  className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 max-w-full truncate rounded bg-ink-100 px-2 py-1 text-xs text-ink-700 dark:bg-ink-900 dark:text-ink-200">
              {publicUrl}
            </code>
            <CopyButton value={publicUrl} label="Copy link" />
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary h-8 text-xs"
            >
              <ExternalLink className="h-4 w-4" />
              View
            </a>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-400">
            <Link
              href={`/dashboard/links/${link.id}/uploads`}
              className="font-medium text-brand hover:underline"
            >
              {link.completed_count} {link.completed_count === 1 ? "upload" : "uploads"} →
            </Link>
            <span>Created {formatDate(link.created_at)}</span>
            {link.expires_at && <span>Expires {formatDate(link.expires_at)}</span>}
          </div>

          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-1 sm:flex-shrink-0 sm:justify-end">
          <Link
            href={`/dashboard/links/${link.id}/qr`}
            className="btn-ghost h-8 px-2 text-xs"
            aria-label="QR code"
          >
            <QrCode className="h-4 w-4" />
            QR
          </Link>
          <Link
            href={`/dashboard/links/${link.id}/embed`}
            className="btn-ghost h-8 px-2 text-xs"
            aria-label="Embed"
          >
            <Code2 className="h-4 w-4" />
            Embed
          </Link>
          <Link
            href={`/dashboard/links/${link.id}/edit`}
            className="btn-ghost h-8 px-2 text-xs"
            aria-label="Edit"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
          <button
            type="button"
            onClick={duplicate}
            disabled={isPending}
            className="btn-ghost h-8 px-2 text-xs"
            aria-label="Duplicate"
          >
            <Copy className="h-4 w-4" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={toggleActive}
            disabled={isPending}
            className="btn-secondary h-8 text-xs"
          >
            {link.is_active ? "Deactivate" : "Activate"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            className="btn-ghost h-8 px-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ active, expired }: { active: boolean; expired: boolean }) {
  if (expired) {
    return (
      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
        Expired
      </span>
    );
  }
  return active ? (
    <span className="rounded-md bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-100">
      Active
    </span>
  ) : (
    <span className="rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
      Inactive
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
