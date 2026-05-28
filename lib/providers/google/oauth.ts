/**
 * Google OAuth helpers (server-only).
 *
 * Implements the full OAuth 2.0 Authorization Code flow with offline access:
 *   1. buildAuthorizationUrl(state) — redirect user to Google consent
 *   2. exchangeCode(code)           — code → tokens + account identity
 *   3. refreshAccessToken(refresh)  — refresh expired access tokens
 *   4. revoke(refresh)              — best-effort revoke at Google
 *
 * Scope choices:
 *   - drive.file       — upload to any folder by ID; can only see files we
 *                        created. Least-privilege scope for uploads.
 *   - drive.readonly   — required by Google Picker so the user can browse
 *                        their folders and pick one. We only read folder
 *                        metadata at picker time, never file contents.
 *   - openid + email + profile — read the user's stable account id (sub)
 *                                and email for the storage_connections row.
 *
 * We always pass prompt=consent so Google issues a refresh token every
 * time. Without that flag Google omits the refresh token on repeat
 * consents from the same user, silently breaking long-lived connections.
 *
 * Why /v3/userinfo instead of decoding the id_token JWT?
 *   The userinfo endpoint is a simple authenticated GET — no JWT parsing,
 *   no JWKS fetching, no signature verification needed. Same information,
 *   smaller blast radius.
 *
 * References:
 *   https://developers.google.com/identity/protocols/oauth2/web-server
 *   https://developers.google.com/identity/openid-connect/openid-connect#userinfo
 */
import "server-only";
import { googleEnv } from "@/lib/env";
import type { OAuthExchangeResult, OAuthRefreshResult } from "@/lib/providers/types";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
  "email",
  "profile",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

// ---- Authorization URL -----------------------------------------------------

/**
 * Build the consent URL we redirect the user to. `state` is a random token
 * that must round-trip through Google and match the value we stashed in an
 * HttpOnly cookie (see lib/state.ts).
 */
export function buildAuthorizationUrl(state: string): string {
  const env = googleEnv();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---- Code exchange ---------------------------------------------------------

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

interface GoogleUserinfoResponse {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
}

/**
 * Exchange an authorization code for tokens and account identity.
 * Returns an OAuthExchangeResult ready to be stored on a
 * storage_connections row.
 */
export async function exchangeCode(code: string): Promise<OAuthExchangeResult> {
  const env = googleEnv();

  // 1. Authorization code -> tokens
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString(),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(
      `Google token exchange failed (${tokenRes.status}): ${errText.slice(0, 500)}`,
    );
  }

  const tokens = (await tokenRes.json()) as GoogleTokenResponse;

  if (!tokens.refresh_token) {
    // Should never happen because we send prompt=consent, but be loud if it does.
    throw new Error(
      "Google did not return a refresh token. Try revoking access at " +
        "https://myaccount.google.com/permissions and reconnect.",
    );
  }

  // 2. Access token -> user identity
  const userinfoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
  });

  if (!userinfoRes.ok) {
    const errText = await userinfoRes.text();
    throw new Error(
      `Google userinfo fetch failed (${userinfoRes.status}): ${errText.slice(0, 500)}`,
    );
  }

  const profile = (await userinfoRes.json()) as GoogleUserinfoResponse;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    providerAccountId: profile.sub,
    providerEmail: profile.email,
    scopes: tokens.scope.split(/\s+/).filter(Boolean),
    providerMetadata: {
      user_picture_url: profile.picture ?? null,
      user_name: profile.name ?? null,
      locale: profile.locale ?? null,
      email_verified: profile.email_verified ?? null,
    },
  };
}

// ---- Refresh ---------------------------------------------------------------

interface GoogleRefreshResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

/**
 * Refresh an expired access token. Google does NOT rotate refresh tokens on
 * refresh, so we don't return a new refresh token. Caller should persist
 * the new access token + expiry on the connection row.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<OAuthRefreshResult> {
  const env = googleEnv();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Google token refresh failed (${res.status}): ${errText.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as GoogleRefreshResponse;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ---- Revoke ----------------------------------------------------------------

/**
 * Best-effort revoke at Google. Failures are non-fatal — we still delete
 * the connection row even if Google's endpoint is unreachable, so a user
 * can always disconnect from our side.
 */
export async function revoke(refreshToken: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      cache: "no-store",
    });
  } catch {
    // Swallow — best-effort.
  }
}

// Re-export endpoint URLs for tests / debugging.
export const _endpoints = {
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  REVOKE_ENDPOINT,
  USERINFO_ENDPOINT,
};
