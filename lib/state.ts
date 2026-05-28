/**
 * OAuth state cookie helpers.
 *
 * The "state" param in OAuth flows is a CSRF defense. The flow:
 *
 *   1. /connect generates a random state, sets it in an HttpOnly cookie,
 *      and includes it in the consent URL we redirect to.
 *   2. The provider redirects back to /callback?...&state=X.
 *   3. /callback reads the cookie, compares cookie value === query param,
 *      then clears the cookie.
 *
 * Because the cookie is HttpOnly and SameSite=Lax, an attacker who tricks
 * a user into hitting /callback?code=ATTACKER_CODE&state=ATTACKER_STATE
 * can't supply a matching cookie — the request will fail state validation.
 */
import { cookies } from "next/headers";
import { randomBytes } from "crypto";

const STATE_COOKIE = "nu_oauth_state";
const STATE_TTL_SECONDS = 60 * 10; // 10 minutes — plenty for a normal consent flow

/** Generate a fresh state token (URL-safe base64, ~43 chars, 256 bits). */
export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

/** Set the state cookie. Call from a Route Handler — server-component cookies are read-only. */
export function setStateCookie(state: string): void {
  cookies().set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
}

/**
 * Read the state cookie and clear it in the same operation. Returns null
 * if no cookie was present. Always clear, even on validation failure, so a
 * second callback attempt with the same state can't replay.
 */
export function readAndClearStateCookie(): string | null {
  const store = cookies();
  const value = store.get(STATE_COOKIE)?.value ?? null;
  if (value !== null) {
    store.delete(STATE_COOKIE);
  }
  return value;
}
