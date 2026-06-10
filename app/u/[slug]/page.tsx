/**
 * Public upload page — /u/[slug]
 *
 * Standalone branded page visitors land on from a shared link. Renders the
 * shared UploadCard plus a privacy note and the "Powered by" attribution.
 * Reads only the upload_links_public view (no folder/provider/owner exposure).
 */
import { ShieldCheck } from "lucide-react";
import { UploadCard } from "@/components/upload-card";
import { UploadGate } from "@/components/upload-gate";
import { getPublicLinkBySlug } from "@/lib/links";
import { getAirtableRecordValuesBySlug } from "@/lib/airtable/record-prefill";

export const dynamic = "force-dynamic";

function buildPrefill(searchParams: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (v == null) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? (v[0] ?? "") : v;
  }
  return out;
}

function firstStr(v: string | string[] | undefined): string | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function PublicUploadPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const link = await getPublicLinkBySlug(params.slug);
  const prefill = buildPrefill(searchParams);
  const recordId = firstStr(searchParams.record) ?? firstStr(searchParams.recordId);

  if (!link) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-display text-2xl font-bold">This upload link isn&apos;t available</h1>
          <p className="mt-2 text-ink-500">
            The link may have been deactivated, expired, or the address is incorrect.
            Double-check with whoever shared it with you.
          </p>
        </div>
        <PoweredBy />
      </main>
    );
  }

  // Airtable record personalization: if the link opted in and the URL carries a
  // record id, pull that record's columns as merge/prefill values (URL params
  // still win). Server-side only — the owner's token never touches the client.
  const recordValues = recordId ? await getAirtableRecordValuesBySlug(params.slug, recordId) : {};
  const mergedPrefill =
    Object.keys(recordValues).length > 0 ? { ...recordValues, ...prefill } : prefill;

  return (
    <main className="min-h-screen bg-ink-50 px-4 py-10 dark:bg-ink-950">
      <div className="mx-auto max-w-xl">
        {link.requires_password ? (
          <UploadGate
            slug={link.slug}
            name={link.name}
            description={link.description}
            accent={link.branding_color ?? "#2563eb"}
            brandingLogoUrl={link.branding_logo_url}
            prefill={mergedPrefill}
            recordId={recordId}
          />
        ) : (
          <UploadCard link={link} showBrandHeader prefill={mergedPrefill} recordId={recordId} />
        )}

        <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Files upload privately. You won&apos;t see other people&apos;s uploads or the owner&apos;s files.
        </div>
        <PoweredBy />
      </div>
    </main>
  );
}

/** Brand attribution shown on every public page — a viral-growth surface. */
function PoweredBy() {
  return (
    <p className="mt-6 text-center text-xs text-ink-400">
      Powered by{" "}
      <a
        href="https://nocodeupload.com/?ref=upload"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-ink-500 hover:text-brand hover:underline dark:text-ink-300"
      >
        NoCodeUpload.com
      </a>
    </p>
  );
}
