/**
 * Google Picker helpers.
 *
 * The Picker SDK runs in the BROWSER and needs:
 *   - The OAuth client ID    (NEXT_PUBLIC_GOOGLE_CLIENT_ID)
 *   - A Picker API key       (NEXT_PUBLIC_GOOGLE_PICKER_API_KEY)
 *   - The project number     (NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER)
 *   - An OAuth access token for the Picker session
 *
 * That access token is minted IN THE BROWSER via Google Identity Services (see
 * components/folder-picker.tsx). It has to be: the Picker renders Drive against
 * the browser's Google session, and a server-minted token gave it no session at
 * all — so it 403'd for everyone who wasn't already signed into Google as the
 * connected account. As a bonus, no Google access token is handed to the browser
 * by our API any more; the refresh token has never left the server.
 */
import "server-only";
import { publicGoogleEnv } from "@/lib/env";

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

