"use client";

/**
 * Filter bar for the Submissions inbox: search (uploader name/email/message) +
 * link and project dropdowns. Each change updates the URL query params so the
 * server component re-queries; the inbox stays a server-rendered list.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

interface Option {
  id: string;
  name: string;
}

interface SubmissionsFiltersProps {
  links: Option[];
  projects: Option[];
  current: { link?: string; project?: string; q?: string };
}

export function SubmissionsFilters({ links, projects, current }: SubmissionsFiltersProps) {
  const router = useRouter();
  const [q, setQ] = useState(current.q ?? "");

  function navigate(next: { link?: string; project?: string; q?: string }) {
    const params = new URLSearchParams();
    const link = next.link ?? current.link;
    const project = next.project ?? current.project;
    const query = next.q ?? current.q;
    if (link) params.set("link", link);
    if (project) params.set("project", project);
    if (query) params.set("q", query);
    const qs = params.toString();
    router.push(qs ? `/dashboard/submissions?${qs}` : "/dashboard/submissions");
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-700">
        <Search className="h-4 w-4 flex-shrink-0 text-ink-400" />
        <input
          className="w-full bg-transparent text-sm outline-none"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate({ q });
          }}
          placeholder="Search by name, email, or message…"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              navigate({ q: "" });
            }}
            className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <select
        className="input w-auto"
        value={current.link ?? ""}
        onChange={(e) => navigate({ link: e.target.value })}
        aria-label="Filter by link"
      >
        <option value="">All links</option>
        {links.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      {projects.length > 0 && (
        <select
          className="input w-auto"
          value={current.project ?? ""}
          onChange={(e) => navigate({ project: e.target.value })}
          aria-label="Filter by project"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
