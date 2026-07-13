/**
 * Product feature flags.
 *
 * YOUTUBE_ENABLED — gates the YouTube destination + connecting a YouTube
 * account. Turned OFF while we pursue Google OAuth verification for Drive only:
 * hiding YouTube means the app never requests the youtube.upload scope, so the
 * verification stays focused on drive.file (the live feature). Flip back to true
 * once the YouTube API Services audit + quota extension are approved and the
 * YouTube feature is ready to ship.
 */
export const YOUTUBE_ENABLED = false;
