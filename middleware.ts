/**
 * Next.js middleware — runs on every request to:
 *
 *  1. Refresh the Supabase session cookie if it's stale. Without this,
 *     session tokens silently expire and users see "logged out" mid-session.
 *
 *  2. Gate protected paths. Anyone hitting /dashboard or /settings without
 *     a valid session gets bounced to /login. Anyone already signed in who
 *     hits /login or /signup gets bounced to /dashboard.
 *
 * Matcher excludes static assets, Next internals, and the OAuth callback
 * (which sets cookies on its own).
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

const PROTECTED_PREFIXES = ["/dashboard", "/settings"];
const AUTH_ONLY_PREFIXES = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  // Canonical host: force the bare apex (nocodeupload.com) to www. `www` is the
  // canonical host — Supabase Site URL, the Google OAuth authorized JS origins,
  // and the Picker API key's HTTP-referrer restrictions are all registered for
  // www. A visitor who lands on the apex would otherwise hit the Google Picker's
  // "403 — you do not have access to this page" because the apex origin isn't
  // allowlisted. Explicit apex-only check → no redirect loop, env-independent,
  // and preview/localhost hosts are untouched.
  if (request.headers.get("host") === "nocodeupload.com") {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = "www.nocodeupload.com";
    return NextResponse.redirect(url, 308);
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const env = publicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  // Touch the user — this is what refreshes the cookie if it's stale.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthOnly = AUTH_ONLY_PREFIXES.some((p) => pathname.startsWith(p));

  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthOnly && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  // Baseline security headers on every response.
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Framing policy: only /embed/* may be embedded in third-party sites; every
  // other route denies framing to prevent clickjacking (esp. the dashboard).
  if (pathname.startsWith("/embed")) {
    response.headers.set("Content-Security-Policy", "frame-ancestors *");
    response.headers.delete("X-Frame-Options");
  } else {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    response.headers.set("X-Frame-Options", "DENY");
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static (static files)
     *  - _next/image (image optimization)
     *  - favicon.ico
     *  - public folder assets (anything with a file extension)
     *  - /auth/callback (OAuth callback sets cookies itself)
     */
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.[\\w]+$).*)",
  ],
};
