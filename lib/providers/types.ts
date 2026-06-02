/**
 * The provider contract that every storage adapter under
 * `lib/providers/<provider>/` must satisfy.
 *
 * Three surface areas:
 *
 *   1. Identity      — what the provider IS (id, displayName, icon, scopes).
 *   2. OAuth         — server-side: build auth URL, exchange code for tokens,
 *                      refresh tokens, revoke. Each provider owns its own
 *                      token shape (Google uses access+refresh, Dropbox uses
 *                      access only with refresh on-demand, etc.).
 *   3. Storage ops   — server-side: initiate a resumable upload session for
 *                      a given (connection, folderId, filename, mime, size).
 *                      Returns a URL the browser can PUT chunks to directly.
 *
 * Plus a small browser-side `pickerConfig` so the folder picker can be
 * rendered per provider without hard-coding Google everywhere.
 *
 * Adapters are intentionally NOT classes — they're plain objects implementing
 * this interface. That keeps things tree-shakable and side-effect-free.
 */
import type { StorageProvider } from "@/lib/db-types";

/** Identity + UI metadata for a provider. */
export interface ProviderInfo {
  id: StorageProvider;
  displayName: string;
  description: string;
  /** Lucide icon name; UI looks up the actual component by name */
  iconName: string;
  /** Whether the provider is fully implemented and ready to use */
  status: "available" | "coming_soon";
}

/** Result of exchanging an OAuth code for tokens. */
export interface OAuthExchangeResult {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry time. */
  expiresAt: Date;
  providerAccountId: string;
  providerEmail: string | null;
  scopes: string[];
  /** Arbitrary provider-owned metadata to persist on the connection row. */
  providerMetadata: Record<string, unknown>;
}

/** Result of refreshing an access token. */
export interface OAuthRefreshResult {
  accessToken: string;
  expiresAt: Date;
  /** Some providers rotate refresh tokens on refresh. */
  newRefreshToken?: string;
}

/** Result of initiating a resumable upload. */
export interface ResumableUploadSession {
  /**
   * The URL the browser PUTs chunks to. For Google Drive this is a
   * one-time URL Google returns in the Location header of the
   * resumable session init.
   */
  sessionUrl: string;
  /**
   * Recommended chunk size for the client to use. Provider-specific
   * (Google requires multiples of 256 KB).
   */
  chunkSize: number;
}

export interface ProviderAdapter {
  info: ProviderInfo;

  /** OAuth surface — server only. */
  oauth: {
    /** Construct the consent URL to redirect the user to. */
    buildAuthorizationUrl(state: string): string;
    /** Exchange an OAuth code for tokens + account identity. */
    exchangeCode(code: string): Promise<OAuthExchangeResult>;
    /** Refresh an expired access token. */
    refreshAccessToken(refreshToken: string): Promise<OAuthRefreshResult>;
    /** Revoke a refresh token (best-effort). */
    revoke(refreshToken: string): Promise<void>;
  };

  /** Storage operations — server only. */
  storage: {
    /**
     * Start a resumable upload to `folderId`. Returns a URL the browser can
     * PUT chunks to directly. Token freshness is the caller's concern
     * (route uses getValidAccessToken, which is provider-agnostic), so this
     * receives a ready-to-use access token rather than the connection row.
     */
    initiateResumableUpload(args: {
      accessToken: string;
      folderId: string;
      filename: string;
      mimeType: string;
      size: number;
    }): Promise<ResumableUploadSession>;
  };
}

/** Helper: registry mapping provider id → adapter. */
export type ProviderRegistry = Record<StorageProvider, ProviderAdapter>;
