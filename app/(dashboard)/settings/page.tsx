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
  Youtube,
  CloudOff,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { DisconnectButton } from "@/components/disconnect-button";
import { LogoUploader } from "@/components/logo-uploader";
import { DefaultAccentField } from "@/components/default-accent-field";
import { YOUTUBE_ENABLED } from "@/lib/features";
import { DestinationsManager, type DestinationSummary } from "@/components/destinations-manager";
import { AirtableConnection } from "@/components/airtable-connection";
import { CollapsibleSection } from "@/components/collapsible-section";
import { requireUser } from "@/lib/auth";
import { isGoogleConfigured, features } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PROVIDER_INFO, PROVIDER_DISPLAY_ORDER } from "@/lib/providers/registry";
import { listUserConnections, type ConnectionSummary } from "@/lib/connections";
import { listDestinations, listSlackConnections, type SlackConnectionSummary } from "@/lib/notifications/destinations";
import { getAirtableConnection } from "@/lib/airtable/connection";
import type { StorageProvider } from "@/lib/db-types";

const ICONS: Record<string, LucideIcon> = {
  HardDrive,
  Cloud,
  Package,
  Box: BoxIcon,
  Youtube,
};

/** Provider-specific OAuth connect URL. */
function getConnectUrl(provider: StorageProvider): string | null {
  switch (provider) {
    case "google_drive":
      return "/api/google/connect";
    case "youtube":
      // Same Google OAuth app, different scopes — the target param tells the
      // callback to store a 'youtube' connection with youtube.upload scope.
      return "/api/google/connect?target=youtube";
    default:
      return null;
  }
}

function isProviderEnvConfigured(provider: StorageProvider): boolean {
  switch (provider) {
    case "google_drive":
    case "youtube":
      // Both ride the same Google OAuth client credentials.
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

  // Notification destinations + email-sending status (best-effort).
  let destinations: DestinationSummary[] = [];
  try {
    destinations = await listDestinations(user.id);
  } catch {
    /* non-fatal */
  }
  let emailConfigured = false;
  let slackConfigured = false;
  try {
    const f = features();
    emailConfigured = f.emailNotifications;
    slackConfigured = f.slack;
  } catch {
    /* non-fatal */
  }
  let slackConnections: SlackConnectionSummary[] = [];
  try {
    slackConnections = await listSlackConnections(user.id);
  } catch {
    /* non-fatal */
  }
  let airtableConnected = false;
  try {
    airtableConnected = (await getAirtableConnection(user.id)) !== null;
  } catch {
    /* non-fatal */
  }

  // Current account logo + default accent color (best-effort).
  let logoUrl: string | null = null;
  let defaultAccentColor: string | null = null;
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("profiles")
      .select("logo_url, default_accent_color")
      .eq("id", user.id)
      .maybeSingle();
    const p = data as { logo_url: string | null; default_accent_color: string | null } | null;
    logoUrl = p?.logo_url ?? null;
    defaultAccentColor = p?.default_accent_color ?? null;
  } catch {
    /* non-fatal */
  }

  const byProvider: Record<StorageProvider, ConnectionSummary[]> = {
    google_drive: [],
    youtube: [],
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
      : searchParams.connected === "youtube"
        ? "YouTube connected."
        : searchParams.connected === "slack"
          ? "Slack connected."
          : searchParams.connected
            ? `${searchParams.connected} connected.`
            : null;

  return (
    <>
      <Topbar email={user.email} title="Settings" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-6">
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

          <CollapsibleSection
            title="Connected storage providers"
            description="NoCode Upload sends files to the storage provider of your choice. We never store files ourselves. Connect a provider to start creating upload links."
            defaultOpen
          >
          {PROVIDER_DISPLAY_ORDER.map((id) => {
            const info = PROVIDER_INFO[id];
            const Icon = ICONS[info.iconName] ?? HardDrive;
            // YouTube is gated off during Drive-only Google verification — show it
            // as "Coming soon" so no new youtube.upload grants are requested.
            const isAvailable =
              info.status === "available" && !(id === "youtube" && !YOUTUBE_ENABLED);
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
                            {c.needs_reconnect && (
                              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                <span>
                                  <strong className="font-semibold">Reconnect needed.</strong> This
                                  account didn&apos;t grant file access, so uploads to it will fail.
                                  Disconnect and connect again — and be sure to check the{" "}
                                  {info.displayName} permission box on Google&apos;s screen.
                                </span>
                              </div>
                            )}
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
          </CollapsibleSection>

          <CollapsibleSection
            title="Branding"
            description="Personalize your upload pages and notification emails."
            defaultOpen
          >
            <LogoUploader currentLogoUrl={logoUrl} />
            <div className="mt-6 border-t border-ink-100 pt-6 dark:border-ink-800">
              <DefaultAccentField currentColor={defaultAccentColor} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Notifications"
            description="How you and your team hear about new uploads. Add destinations here, then route to them per link with rules."
            defaultOpen
          >
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                emailConfigured
                  ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-900/30 dark:text-green-100"
                  : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100"
              }`}
            >
              {emailConfigured ? (
                <>Email sending is <strong>active</strong>. Upload notifications will be delivered.</>
              ) : (
                <>
                  Email sending is <strong>not configured</strong> on this deployment — that&apos;s
                  why notification emails aren&apos;t arriving. Set{" "}
                  <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">RESEND_API_KEY</code>{" "}
                  and{" "}
                  <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">RESEND_FROM_EMAIL</code>{" "}
                  (a verified Resend domain) to turn it on.
                </>
              )}
            </div>
            <DestinationsManager
              destinations={destinations}
              slackConfigured={slackConfigured}
              slackConnections={slackConnections}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Airtable"
            description="Turn uploads into Airtable records. Connect once here, then choose the base, table, and field mapping per link."
          >
            <AirtableConnection connected={airtableConnected} />
          </CollapsibleSection>

          <CollapsibleSection title="Account" description={`Signed in as ${user.email}`}>
            <p className="text-sm text-ink-500">
              You&apos;re signed in. Use the top bar to log out.
            </p>
          </CollapsibleSection>
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
