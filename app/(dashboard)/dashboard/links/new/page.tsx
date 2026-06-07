/**
 * Create a new upload link. Requires at least one connected storage account;
 * if none, redirect to Settings (you can't point a link at nothing).
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { LinkForm } from "@/components/link-form";
import { requireUser } from "@/lib/auth";
import { isGoogleConfigured, publicGoogleEnv } from "@/lib/env";
import { listUserConnections } from "@/lib/connections";
import { listDestinations, type DestinationSummary } from "@/lib/notifications/destinations";
import { listProjects, type ProjectSummary } from "@/lib/projects";
import { listTags, type TagSummary } from "@/lib/tags";

export default async function NewLinkPage() {
  const user = await requireUser();

  // Need a provider configured at the env level AND a connected account.
  if (!isGoogleConfigured()) redirect("/settings");
  const connections = await listUserConnections(user.id);
  if (connections.length === 0) redirect("/settings");

  let destinations: DestinationSummary[] = [];
  try {
    destinations = await listDestinations(user.id);
  } catch {
    /* non-fatal */
  }
  let projects: ProjectSummary[] = [];
  try {
    projects = await listProjects(user.id);
  } catch {
    /* non-fatal */
  }
  let allTags: TagSummary[] = [];
  try {
    allTags = await listTags(user.id);
  } catch {
    /* non-fatal */
  }

  const env = publicGoogleEnv();
  const pickerConfig = {
    apiKey: env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
    projectNumber: env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
  };

  return (
    <>
      <Topbar email={user.email} title="New upload link" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 dark:hover:text-ink-50">
            <ArrowLeft className="h-4 w-4" />
            Back to links
          </Link>
          <LinkForm
            mode="create"
            connections={connections}
            pickerConfig={pickerConfig}
            destinations={destinations}
            projects={projects}
            allTags={allTags}
          />
        </div>
      </main>
    </>
  );
}
