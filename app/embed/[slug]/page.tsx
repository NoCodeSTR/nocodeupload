/**
 * Embeddable upload page — /embed/[slug]
 *
 * The iframe-friendly variant of /u/[slug]. Compact chrome (no full-screen
 * centering, no big brand header) so it sits naturally inside a host's site.
 * Framing is allowed for this route only — see middleware.ts, which sets
 * `Content-Security-Policy: frame-ancestors *` here and denies framing
 * everywhere else (clickjacking protection for the dashboard/auth pages).
 *
 * Keeps the "Powered by" link — embedding spreads it onto other sites, which
 * is the point.
 */
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

export default async function EmbedUploadPage({
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
      <main className="flex min-h-[300px] items-center justify-center bg-white px-4 py-8 dark:bg-ink-950">
        <p className="text-center text-sm text-ink-500">
          This upload link isn&apos;t available.
        </p>
      </main>
    );
  }

  const recordValues = recordId ? await getAirtableRecordValuesBySlug(params.slug, recordId) : {};
  const mergedPrefill =
    Object.keys(recordValues).length > 0 ? { ...recordValues, ...prefill } : prefill;

  return (
    <main className="bg-white px-4 py-6 dark:bg-ink-950">
      <div className="mx-auto max-w-lg">
        {link.requires_password ? (
          <UploadGate
            slug={link.slug}
            name={link.name}
            description={link.description}
            accent={link.branding_color ?? "#2563eb"}
            brandingLogoUrl={link.branding_logo_url}
            showBrandHeader={false}
            prefill={mergedPrefill}
            recordId={recordId}
          />
        ) : (
          <UploadCard link={link} showBrandHeader={false} prefill={mergedPrefill} recordId={recordId} />
        )}
        <p className="mt-3 text-center text-xs text-ink-400">
          Powered by{" "}
          <a
            href="https://nocodeupload.com/?ref=embed"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink-500 hover:underline dark:text-ink-300"
          >
            NoCodeUpload.com
          </a>
        </p>
      </div>
    </main>
  );
}
