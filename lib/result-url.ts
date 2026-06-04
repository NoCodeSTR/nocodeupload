/**
 * Build the human-facing "open/view" URL for a completed upload, by provider.
 * Isomorphic (no server-only deps) so the dashboard, email, and webhook can all
 * use it.
 */
import type { StorageProvider } from "@/lib/db-types";

export function resultUrlFor(
  provider: StorageProvider | null | undefined,
  providerFileId: string | null | undefined,
): string | null {
  if (!providerFileId) return null;
  switch (provider) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${providerFileId}`;
    case "google_drive":
    default:
      return `https://drive.google.com/file/d/${providerFileId}/view`;
  }
}

/** Label for the "open" action, by provider. */
export function resultUrlLabel(provider: StorageProvider | null | undefined): string {
  return provider === "youtube" ? "Watch on YouTube" : "Open in Drive";
}
