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
import { PublicUploader } from "@/components/public-uploader";
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

          {/* Working uploader (M7) */}
          <div className="mt-6">
            <PublicUploader
              slug={link.slug}
              requireName={link.require_name}
              requireEmail={link.require_email}
              showMessageField={link.show_message_field}
              maxFileSizeMb={link.max_file_size_mb}
              allowedMimeTypes={link.allowed_mime_types}
              accent={accent}
            />
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
