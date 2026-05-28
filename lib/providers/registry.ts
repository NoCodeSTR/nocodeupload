/**
 * Provider registry — single source of truth for what providers exist,
 * their UI metadata, and how to look up an adapter by id.
 *
 * Adding a new provider:
 *   1. Create lib/providers/<name>/ with oauth.ts and storage.ts.
 *   2. Export an adapter from lib/providers/<name>/index.ts implementing
 *      ProviderAdapter.
 *   3. Add it to PROVIDER_INFO and to `getAdapter()` below.
 *   4. Add the provider id to the SQL check constraint on
 *      storage_connections.provider.
 */
import type { StorageProvider } from "@/lib/db-types";
import type { ProviderAdapter, ProviderInfo } from "./types";

/**
 * UI-facing metadata for every provider, including ones that aren't
 * implemented yet. This is what the Settings page renders.
 */
export const PROVIDER_INFO: Record<StorageProvider, ProviderInfo> = {
  google_drive: {
    id: "google_drive",
    displayName: "Google Drive",
    description:
      "Drop files into any folder in your Google Drive. Best for hosts already organizing media on Drive.",
    iconName: "HardDrive",
    status: "available",
  },
  dropbox: {
    id: "dropbox",
    displayName: "Dropbox",
    description: "Send uploads to a Dropbox folder. Roadmap item.",
    iconName: "Package",
    status: "coming_soon",
  },
  box: {
    id: "box",
    displayName: "Box",
    description: "Send uploads to a Box folder. Roadmap item.",
    iconName: "Box",
    status: "coming_soon",
  },
  onedrive: {
    id: "onedrive",
    displayName: "OneDrive",
    description: "Send uploads to a OneDrive folder. Roadmap item.",
    iconName: "Cloud",
    status: "coming_soon",
  },
};

/**
 * Get the runtime adapter for a provider id. Imports are dynamic so that
 * an environment missing one provider's credentials (e.g. no Google env
 * vars set) doesn't crash on import — only when actually used.
 *
 * Throws if the provider is recognized but unimplemented (coming_soon),
 * or if the provider id is unknown.
 */
export async function getAdapter(provider: StorageProvider): Promise<ProviderAdapter> {
  switch (provider) {
    case "google_drive": {
      const { googleDriveAdapter } = await import("./google");
      return googleDriveAdapter;
    }
    case "dropbox":
    case "box":
    case "onedrive":
      throw new Error(
        `Provider "${provider}" is on the roadmap but not implemented yet.`,
      );
    default: {
      // Exhaustiveness check — TS will error here if a new provider is
      // added to StorageProvider without a case above.
      const _exhaustive: never = provider;
      throw new Error(`Unknown storage provider: ${_exhaustive}`);
    }
  }
}

/** Convenience: list providers in a fixed display order for the UI. */
export const PROVIDER_DISPLAY_ORDER: StorageProvider[] = [
  "google_drive",
  "dropbox",
  "box",
  "onedrive",
];
