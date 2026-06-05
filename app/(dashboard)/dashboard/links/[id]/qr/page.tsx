/**
 * QR sign page — /dashboard/links/[id]/qr
 *
 * Renders a printable QR sign for one of the user's links. Loads the link
 * (scoped to the user; 404s otherwise), resolves the effective logo (per-link
 * override else the account logo), and builds the public URL the QR encodes.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { QrSign } from "@/components/qr-sign";
import { requireUser } from "@/lib/auth";
import { getLinkForUser } from "@/lib/links";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LinkQrPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const link = await getLinkForUser({ userId: user.id, linkId: params.id });
  if (!link) notFound();

  // Effective logo: per-link override, else the owner's account logo.
  let logoUrl: string | null = link.branding_logo_url;
  if (!logoUrl) {
    try {
      const supabase = createSupabaseServerClient();
      const { data } = await supabase
        .from("profiles")
        .select("logo_url")
        .eq("id", user.id)
        .maybeSingle();
      logoUrl = (data as { logo_url: string | null } | null)?.logo_url ?? null;
    } catch {
      /* non-fatal — fall back to the wordmark */
    }
  }

  const publicUrl = `${publicEnv().NEXT_PUBLIC_APP_URL}/u/${link.slug}`;
  const accent = link.branding_color || "#2563eb";

  return (
    <>
      <Topbar email={user.email} title="QR code" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <Link
            href="/dashboard"
            className="mb-6 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 dark:hover:text-ink-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to links
          </Link>

          <div className="mb-6">
            <h2 className="font-display text-xl font-semibold">{link.name}</h2>
            <p className="mt-1 text-sm text-ink-500">
              Print this sign and post it where people upload from — a cleaner&apos;s closet,
              a check-in binder, a job site. Anyone who scans it lands straight on your upload
              page.
            </p>
          </div>

          <QrSign publicUrl={publicUrl} linkName={link.name} logoUrl={logoUrl} accent={accent} />
        </div>
      </main>
    </>
  );
}
