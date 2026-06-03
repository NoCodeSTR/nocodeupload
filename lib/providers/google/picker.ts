/**
 * Google Picker helpers.
 *
 * The Picker SDK runs in the BROWSER and needs:
 *   - The OAuth client ID    (NEXT_PUBLIC_GOOGLE_CLIENT_ID)
 *   - A Picker API key       (NEXT_PUBLIC_GOOGLE_PICKER_API_KEY)
 *   - The project number     (NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER)
 *   - A short-lived OAuth access token for the Picker session
 *
 * To keep the refresh token off the browser, we mint the short-lived
 * Picker token server-side via `mintPickerToken()` (called from
 * /api/google/picker-token).
 */
import "server-only";
import { publicGoogleEnv } from "@/lib/env";
import { getValidAccessToken } from "@/lib/tokens";

export interface PickerBrowserConfig {
  clientId: string;
  apiKey: string;
  projectNumber: string;
}

/**
 * Returns the three public values the Picker SDK needs in the browser.
 * Safe to call from a "use client" component.
 */
export function getPickerBrowserConfig(): PickerBrowserConfig {
  const env = publicGoogleEnv();
  return {
    clientId: env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    apiKey: env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
    projectNumber: env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
  };
}

/**
 * Mint a fresh Google access token scoped to a specific connection for the
 * Picker. Server-side only — uses the user's stored refresh token (which
 * never touches the browser) to refresh the access token if needed.
 *
 * Returned token carries the user's granted scopes (drive.file +
 * openid/email/profile). The Picker uses it to let the user select a folder,
 * which grants the app per-folder access under drive.file.
 */
export async function mintPickerToken(args: {
  userId: string;
  connectionId: string;
}): Promise<{ accessToken: string; expiresAt: Date }> {
  const { accessToken, expiresAt } = await getValidAccessToken(args);
  return { accessToken, expiresAt };
}
