/**
 * Public upload page — /u/[slug]
 *
 * Anonymous visitors land here from a shared link. M6 renders the branded
 * shell: link name, description, the uploader fields the owner enabled, and a
 * (disabled) drop zone with an "uploads go live shortly" notice. M7 replaces
 * the notice with the working resumable uploader.
 *
 * Reads ONLY from the upload_links_public view (anon-granted), which excludes
 * folder_id, provider, and owner — visitors never learn where files go or
 * whose Drive they land in. The view also filters to active, non-expired
 * links, so an inactive/expired/unknown slug renders the "unavailable" state.
 */
import { Upload, ShieldCheck } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UploadLinkPublicRow } from "@/lib/db-types";

export const dynamic = "force-dynamic";

async function getPublicLink(slug: string): Promise<UploadLinkPublicRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("upload_links_public")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[/u/[slug]] public link query failed:", error.message);
    return null;
  }
  return (data ?? null) as UploadLinkPublicRow | null;
}

export default async function PublicUploadPage({ params }: { params: { slug: string } }) {
  const link = await getPublicLink(params.slug);

  if (!link) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-display text-2xl font-bold">This upload link isn&apos;t available</h1>
          <p className="mt-2 text-ink-500">
            The link may have been deactivated, expired, or the address is incorrect.
            Double-check with whoever shared it with you.
          </p>
        </div>
      </main>
    );
  }

  const accent = link.branding_color ?? "#2563eb";

  return (
    <main className="min-h-screen bg-ink-50 px-4 py-10 dark:bg-ink-950">
      <div className="mx-auto max-w-xl">
        {/* Brand header */}
        <div className="mb-6 flex items-center justify-center">
          {link.branding_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={link.branding_logo_url} alt="" className="h-12 object-contain" />
          ) : (
            <div className="flex items-center gap-2 font-display text-lg font-bold">
              <Upload className="h-6 w-6" style={{ color: accent }} />
              NoCode Upload
            </div>
          )}
        </div>

        <div className="card">
          <h1 className="font-display text-2xl font-bold">{link.name}</h1>
          {link.description && (
            <p className="mt-2 text-ink-500">{link.description}</p>
          )}

          {/* Uploader fields (owner-configured) */}
          <div className="mt-6 space-y-4">
            {link.require_name && (
              <div>
                <label className="label mb-1" htmlFor="uploader-name">
                  Your name <span className="text-red-500">*</span>
                </label>
                <input id="uploader-name" className="input" placeholder="Jane Doe" disabled />
              </div>
            )}
            {link.require_email && (
              <div>
                <label className="label mb-1" htmlFor="uploader-email">
                  Your email <span className="text-red-500">*</span>
                </label>
                <input id="uploader-email" type="email" className="input" placeholder="jane@example.com" disabled />
              </div>
            )}
            {link.show_message_field && (
              <div>
                <label className="label mb-1" htmlFor="uploader-message">
                  Message <span className="font-normal text-ink-400">(optional)</span>
                </label>
                <textarea id="uploader-message" className="input min-h-[72px]" placeholder="Anything we should know?" disabled />
              </div>
            )}

            {/* Drop zone (disabled in M6) */}
            <div
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-300 px-6 py-12 text-center dark:border-ink-700"
              aria-disabled
            >
              <Upload className="mb-3 h-8 w-8 text-ink-400" />
              <p className="font-medium text-ink-700 dark:text-ink-200">Drag &amp; drop files here</p>
              <p className="mt-1 text-sm text-ink-400">
                or tap to choose — up to {formatSize(link.max_file_size_mb)} per file
              </p>
            </div>

            {/* M6 notice — replaced by the working uploader in M7 */}
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ backgroundColor: `${accent}14`, color: accent }}
            >
              This uploader is being set up and will go live shortly. Please check
              back soon.
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Files upload privately. You won&apos;t see other people&apos;s uploads or the owner&apos;s files.
        </div>
      </div>
    </main>
  );
}

function formatSize(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}
