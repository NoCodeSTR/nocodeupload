/**
 * Settings — Connected storage providers.
 *
 * Driven by lib/providers/registry.ts so adding a new provider is a
 * one-liner (plus an adapter implementation). For each provider card
 * we show:
 *
 *   - List of the user's existing connections (provider_email, connected_at)
 *     each with a Disconnect button and (for Google) a Picker test widget.
 *   - A Connect button if the provider is implemented + env-configured.
 *   - "Not configured" badge if implemented but no env credentials set.
 *   - "Coming soon" badge if not yet implemented.
 *
 * The Picker test widget is M5 scaffolding — M6 will replace it with the
 * upload-link creation form.
 */
import Link from "next/link";
import {
  HardDrive,
  Cloud,
  Package,
  Box as BoxIcon,
  CloudOff,
  type LucideIcon,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DisconnectButton } from "@/components/disconnect-button";
import { LogoUploader } from "@/components/logo-uploader";
import { requireUser } from "@/lib/auth";
import { isGoogleConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PROVIDER_INFO, PROVIDER_DISPLAY_ORDER } from "@/lib/providers/registry";
import { listUserConnections, type ConnectionSummary } from "@/lib/connections";
import type { StorageProvider } from "@/lib/db-types";

const ICONS: Record<string, LucideIcon> = {
  HardDrive,
  Cloud,
  Package,
  Box: BoxIcon,
};

/** Provider-specific OAuth connect URL. */
function getConnectUrl(provider: StorageProvider): string | null {
  switch (provider) {
    case "google_drive":
      return "/api/google/connect";
    default:
      return null;
  }
}

function isProviderEnvConfigured(provider: StorageProvider): boolean {
  switch (provider) {
    case "google_drive":
      return isGoogleConfigured();
    default:
      return false;
  }
}

interface SettingsPageProps {
  searchParams: { connected?: string; error?: string };
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const user = await requireUser();

  // Resilient load: a DB / permissions hiccup shows a banner instead of 500-ing
  // the whole Settings page (which would also block the user from connecting).
  let allConnections: ConnectionSummary[] = [];
  let connectionsError: string | null = null;
  try {
    allConnections = await listUserConnections(user.id);
  } catch (err) {
    connectionsError =
      "We couldn't load your connected accounts just now. You can still connect a new one below; refresh to retry.";
    // eslint-disable-next-line no-console
    console.error("[settings] failed to load connections:", err);
  }

  // Current account logo (best-effort).
  let logoUrl: string | null = null;
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase.from("profiles").select("logo_url").eq("id", user.id).maybeSingle();
    logoUrl = (data as { logo_url: string | null } | null)?.logo_url ?? null;
  } catch {
    /* non-fatal */
  }

  const byProvider: Record<StorageProvider, ConnectionSummary[]> = {
    google_drive: [],
    dropbox: [],
    box: [],
    onedrive: [],
  };
  for (const c of allConnections) {
    byProvider[c.provider]?.push(c);
  }

  const successLabel =
    searchParams.connected === "google_drive"
      ? "Google Drive connected."
      : searchParams.connected
        ? `${searchParams.connected} connected.`
        : null;

  return (
    <>
      <Topbar email={user.email} title="Settings" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h2 className="font-display text-xl font-semibold">Connected storage providers</h2>
            <p className="mt-1 text-sm text-ink-500">
              NoCode Upload sends files to the storage provider of your choice. We
              never store files ourselves. Connect a provider to start creating
              upload links.
            </p>
          </div>

          {successLabel && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-900/30 dark:text-green-100">
              {successLabel}
            </div>
          )}
          {searchParams.error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              {searchParams.error}
            </div>
          )}
          {connectionsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              {connectionsError}
            </div>
          )}

          {PROVIDER_DISPLAY_ORDER.map((id) => {
            const info = PROVIDER_INFO[id];
            const Icon = ICONS[info.iconName] ?? HardDrive;
            const isAvailable = info.status === "available";
            const envReady = isAvailable && isProviderEnvConfigured(id);
            const connectUrl = getConnectUrl(id);
            const connections = byProvider[id];
            const dim = !isAvailable;

            return (
              <div key={id} className={`card ${dim ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-ink-100 dark:bg-ink-900">
                    <Icon className="h-5 w-5 text-ink-700 dark:text-ink-200" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="font-display text-base font-semibold">
                        {info.displayName}
                      </h3>
                      {!isAvailable ? (
                        <span className="inline-flex items-center rounded-md bg-ink-100 px-2 py-1 text-xs font-medium text-ink-600 dark:bg-ink-900 dark:text-ink-300">
                          Coming soon
                        </span>
                      ) : !envReady ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-xs font-medium text-ink-600 dark:bg-ink-900 dark:text-ink-300">
                          <CloudOff className="h-3 w-3" />
                          Not configured
                        </span>
                      ) : connectUrl ? (
                        <Link href={connectUrl} className="btn-primary h-8 text-xs">
                          {connections.length > 0 ? "Add another account" : "Connect"}
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-500">{info.description}</p>

                    {connections.length > 0 && (
                      <ul className="mt-4 space-y-6 border-t border-ink-200 pt-4 dark:border-ink-700">
                        {connections.map((c) => (
                          <li key={c.id}>
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">
                                  {c.provider_email ?? "(no email)"}
                                </p>
                                <p className="text-xs text-ink-500">
                                  Connected {formatDate(c.connected_at)}
                                </p>
                              </div>
                              <DisconnectButton
                                connectionId={c.id}
                                label={c.provider_email ?? info.displayName}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {isAvailable && !envReady && (
                      <p className="mt-3 text-xs text-ink-400">
                        Credentials aren&apos;t set on this deployment. See
                        <code className="mx-1 rounded bg-ink-100 px-1.5 py-0.5 dark:bg-ink-900">
                          docs/google-cloud-setup.md
                        </code>
                        for setup instructions.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="pt-4">
            <h2 className="font-display text-xl font-semibold">Branding</h2>
            <p className="mt-1 text-sm text-ink-500">
              Personalize your upload pages and notification emails.
            </p>
            <div className="mt-3">
              <LogoUploader currentLogoUrl={logoUrl} />
            </div>
          </div>

          <div className="pt-4">
            <h2 className="font-display text-xl font-semibold">Account</h2>
            <p className="mt-1 text-sm text-ink-500">Signed in as {user.email}</p>
          </div>
        </div>
      </main>
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
