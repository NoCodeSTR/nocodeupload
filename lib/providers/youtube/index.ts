/**
 * YouTube adapter — uploads videos to the connected channel.
 *
 * Reuses the Google OAuth module (same Google identity endpoints) but with the
 * youtube.upload scope, and a YouTube-specific resumable upload. Connected as a
 * separate provider ("youtube") so the Drive connection stays on drive.file.
 */
import type { ProviderAdapter } from "@/lib/providers/types";
import { PROVIDER_INFO } from "@/lib/providers/registry";
import * as googleOauth from "@/lib/providers/google/oauth";
import * as youtubeStorage from "./storage";

export const youtubeAdapter: ProviderAdapter = {
  info: PROVIDER_INFO.youtube,
  oauth: {
    buildAuthorizationUrl: (state) =>
      googleOauth.buildAuthorizationUrl(state, googleOauth.YOUTUBE_SCOPES),
    exchangeCode: googleOauth.exchangeCode,
    refreshAccessToken: googleOauth.refreshAccessToken,
    revoke: googleOauth.revoke,
  },
  storage: {
    initiateResumableUpload: youtubeStorage.initiateResumableUpload,
  },
};
