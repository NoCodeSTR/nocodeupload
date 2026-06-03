/**
 * Embed page — gives the host a copy-paste iframe snippet for one link, plus
 * a live preview of how it'll look on their site.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { CopyButton } from "@/components/copy-button";
import { requireUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { getLinkForUser } from "@/lib/links";

export const dynamic = "force-dynamic";

export default async function EmbedPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const link = await getLinkForUser({ userId: user.id, linkId: params.id });
  if (!link) notFound();

  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const embedUrl = `${appUrl}/embed/${link.slug}`;
  const publicUrl = `${appUrl}/u/${link.slug}`;
  const snippet = `<iframe
  src="${embedUrl}"
  width="100%"
  height="640"
  style="border:0;border-radius:12px;max-width:560px"
  title="Upload files"
></iframe>`;

  return (
    <>
      <Topbar email={user.email} title="Embed" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/dashboard"
            className="mb-6 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 dark:hover:text-ink-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to links
          </Link>

          <div className="mb-6">
            <h2 className="font-display text-xl font-semibold">Embed “{link.name}”</h2>
            <p className="mt-1 text-sm text-ink-500">
              Drop the uploader straight into your own website. Paste this snippet
              where you want it to appear.
            </p>
          </div>

          {/* Snippet */}
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Embed code</h3>
              <CopyButton value={snippet} label="Copy code" />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-ink-900 p-4 text-xs leading-relaxed text-ink-50 dark:bg-black">
              <code>{snippet}</code>
            </pre>
            <p className="mt-3 text-xs text-ink-400">
              Adjust <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">height</code> to fit
              your layout. The widget is responsive up to 560px wide.
            </p>
          </div>

          {/* Direct link alternative */}
          <div className="card mt-4">
            <h3 className="font-display text-sm font-semibold">Prefer a plain link?</h3>
            <p className="mt-1 text-xs text-ink-500">
              Share this URL directly — no embedding required.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="truncate rounded bg-ink-100 px-2 py-1 text-xs dark:bg-ink-900">
                {publicUrl}
              </code>
              <CopyButton value={publicUrl} label="Copy link" />
            </div>
          </div>

          {/* Live preview */}
          <div className="mt-6">
            <h3 className="mb-2 font-display text-sm font-semibold">Live preview</h3>
            <div className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-700">
              <iframe
                src={embedUrl}
                width="100%"
                height={640}
                style={{ border: 0 }}
                title="Upload widget preview"
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
