/**
 * Edit an existing upload link. Loads the link (scoped to the user) and the
 * user's connections, then reuses LinkForm in edit mode. 404s via notFound()
 * if the link isn't the user's.
 */
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { LinkForm } from "@/components/link-form";
import { requireUser } from "@/lib/auth";
import { isGoogleConfigured, publicGoogleEnv } from "@/lib/env";
import { listUserConnections } from "@/lib/connections";
import { listDestinations, type DestinationSummary } from "@/lib/notifications/destinations";
import { getLinkForUser } from "@/lib/links";

export default async function EditLinkPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!isGoogleConfigured()) redirect("/settings");

  const link = await getLinkForUser({ userId: user.id, linkId: params.id });
  if (!link) notFound();

  const connections = await listUserConnections(user.id);
  let destinations: DestinationSummary[] = [];
  try {
    destinations = await listDestinations(user.id);
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
      <Topbar email={user.email} title="Edit upload link" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 dark:hover:text-ink-50">
            <ArrowLeft className="h-4 w-4" />
            Back to links
          </Link>
          <LinkForm
            mode="edit"
            connections={connections}
            pickerConfig={pickerConfig}
            initialLink={link}
            destinations={destinations}
          />
        </div>
      </main>
    </>
  );
}
