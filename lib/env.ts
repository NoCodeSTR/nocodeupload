/**
 * Centralized, type-safe environment variable access.
 *
 * Split into three logical surfaces so the app can run without every
 * integration configured:
 *
 *   coreEnv()           Required for the app to boot at all (Supabase,
 *                       encryption key, app URL, optional feature toggles).
 *
 *   googleEnv()         Required only when serving Google OAuth / Drive
 *                       routes. Calling this from any route that doesn't
 *                       need Google credentials would be a bug.
 *
 *   publicEnv()         Browser-safe core vars (Supabase URL + anon key
 *                       + app URL). Validated once per process.
 *
 *   publicGoogleEnv()   Browser-safe Google vars (client ID, picker API
 *                       key, project number). Only required when the
 *                       Google Picker UI is rendered.
 *
 * Plus convenience helpers:
 *
 *   isGoogleConfigured()  true when both server + public Google vars
 *                         validate. Use this on the settings page to
 *                         decide whether to render the "Connect Drive"
 *                         button or a "not configured yet" placeholder.
 *
 *   features()            optional feature flags derived from optional
 *                         core env (emailNotifications, rateLimit).
 *
 * Rules:
 *   - Each getter is lazy + cached: validates on first call, returns
 *     cached value thereafter.
 *   - Throws a clean multi-line error listing every missing/malformed
 *     var on failure — never "undefined is not a function".
 *   - `serverEnv()` is kept as a deprecated alias that just calls
 *     `coreEnv()` — there are a few legacy imports that still use it.
 */
import { z } from "zod";

// =============================================================================
// Schemas
// =============================================================================

const coreSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Token encryption
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex chars (32 bytes)"),

  // Optional integrations
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  // Where to email when a new user signs up (operator alert). Optional.
  ADMIN_NOTIFY_EMAIL: z.string().email().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  // Slack app (OAuth incoming-webhook) — optional; notifications fall back to
  // email/webhook when unset. Redirect URI is derived from NEXT_PUBLIC_APP_URL.
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
});

const googleSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(10),
  GOOGLE_CLIENT_SECRET: z.string().min(10),
  GOOGLE_REDIRECT_URI: z.string().url(),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().min(10),
  NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: z.string().min(10),
  NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: z.string().min(1),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

const publicGoogleSchema = z.object({
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().min(10),
  NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: z.string().min(10),
  NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: z.string().min(1),
});

export type CoreEnv = z.infer<typeof coreSchema>;
export type GoogleEnv = z.infer<typeof googleSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;
export type PublicGoogleEnv = z.infer<typeof publicGoogleSchema>;

// =============================================================================
// Lazy, cached parsers
// =============================================================================

let _coreEnv: CoreEnv | null = null;
let _googleEnv: GoogleEnv | null = null;
let _publicEnv: PublicEnv | null = null;
let _publicGoogleEnv: PublicGoogleEnv | null = null;

function formatError(label: string, err: z.ZodError): never {
  const issues = err.issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `\n❌ Invalid ${label} environment variables:\n${issues}\n\n` +
      `Check your .env.local against .env.local.example.\n`,
  );
}

function assertServer(name: string) {
  if (typeof window !== "undefined") {
    throw new Error(`${name}() called from a browser context`);
  }
}

/**
 * Core server env. Required for the app to function at all.
 * Validates Supabase, encryption key, app URL, and optional feature flags.
 */
export function coreEnv(): CoreEnv {
  assertServer("coreEnv");
  if (_coreEnv) return _coreEnv;
  const result = coreSchema.safeParse(process.env);
  if (!result.success) formatError("core server", result.error);
  _coreEnv = result.data;
  return _coreEnv;
}

/**
 * Google server env. Only required when Google OAuth or Drive routes are hit.
 * Throws with a clear message if the app hasn't been configured for Google yet.
 */
export function googleEnv(): GoogleEnv {
  assertServer("googleEnv");
  if (_googleEnv) return _googleEnv;
  const result = googleSchema.safeParse(process.env);
  if (!result.success) formatError("Google", result.error);
  _googleEnv = result.data;
  return _googleEnv;
}

/**
 * Browser-safe public env. Always required.
 */
export function publicEnv(): PublicEnv {
  if (_publicEnv) return _publicEnv;
  const result = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!result.success) formatError("public", result.error);
  _publicEnv = result.data;
  return _publicEnv;
}

/**
 * Browser-safe Google env. Required only when rendering the Picker.
 */
export function publicGoogleEnv(): PublicGoogleEnv {
  if (_publicGoogleEnv) return _publicGoogleEnv;
  const result = publicGoogleSchema.safeParse({
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
  });
  if (!result.success) formatError("public Google", result.error);
  _publicGoogleEnv = result.data;
  return _publicGoogleEnv;
}

/**
 * Server-side check: is Google fully configured? Use this on the settings
 * page (or anywhere we want to gracefully degrade) to decide whether to show
 * the Connect button or a "not configured" placeholder.
 */
export function isGoogleConfigured(): boolean {
  if (typeof window !== "undefined") return false; // never trust client to know
  const server = googleSchema.safeParse(process.env);
  const pub = publicGoogleSchema.safeParse({
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
    NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER: process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
  });
  return server.success && pub.success;
}

/**
 * Optional features derived from core env.
 */
export function features() {
  const env = coreEnv();
  return {
    emailNotifications: Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL),
    rateLimit: Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
    slack: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
  };
}

/** @deprecated use coreEnv() */
export const serverEnv = coreEnv;
