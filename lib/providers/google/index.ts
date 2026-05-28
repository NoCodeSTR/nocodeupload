/**
 * Google Drive adapter — assembles the per-module pieces into a single
 * `ProviderAdapter` object that satisfies the contract in
 * `lib/providers/types.ts`.
 *
 * Sub-modules:
 *   oauth.ts   — server: authorization URL, code exchange, token refresh, revoke
 *   drive.ts   — server: resumable upload session initiation
 *   picker.ts  — browser: Picker config; server: short-lived token minter
 */
import type { ProviderAdapter } from "@/lib/providers/types";
import { PROVIDER_INFO } from "@/lib/providers/registry";
import * as oauth from "./oauth";
import * as drive from "./drive";

export const googleDriveAdapter: ProviderAdapter = {
  info: PROVIDER_INFO.google_drive,
  oauth: {
    buildAuthorizationUrl: oauth.buildAuthorizationUrl,
    exchangeCode: oauth.exchangeCode,
    refreshAccessToken: oauth.refreshAccessToken,
    revoke: oauth.revoke,
  },
  storage: {
    initiateResumableUpload: drive.initiateResumableUpload,
  },
};

// Re-export submodules so callers can import { GOOGLE_SCOPES } etc.
export * as oauth from "./oauth";
export * as drive from "./drive";
export * as picker from "./picker";
