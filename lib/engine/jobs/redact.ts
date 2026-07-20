/**
 * Error redaction before persistence (ADR-25). last_error and event details are
 * engineering-facing but durable — strip anything credential-shaped and bound
 * the size. Customer-visible messages are COMPOSED by handlers, never raw.
 */
const MAX_ERROR_LEN = 1000;

const PATTERNS: Array<[RegExp, string]> = [
  [/authorization:\s*\S+(\s+\S+)?/gi, "authorization: [redacted]"],
  [/bearer\s+[a-z0-9._~+/=-]+/gi, "bearer [redacted]"],
  [/([?&](?:token|key|secret|password|access_token|refresh_token|api_key)=)[^&\s"']+/gi, "$1[redacted]"],
  [/("(?:token|secret|password|api_key|access_token|refresh_token)"\s*:\s*")[^"]*(")/gi, "$1[redacted]$2"],
];

export function redactError(input: string): string {
  let out = input;
  for (const [re, sub] of PATTERNS) out = out.replace(re, sub);
  return out.length > MAX_ERROR_LEN ? `${out.slice(0, MAX_ERROR_LEN)}…` : out;
}

/**
 * Payload tripwire (ADR-25): reject payloads carrying secret-shaped keys.
 * Payloads must hold entity references; handlers resolve credentials through
 * the vault at execution time.
 */
const SECRET_KEY_RE = /token|secret|password|authorization|api_key|apikey/i;

export function assertPayloadSafe(payload: Record<string, unknown>, path = ""): void {
  for (const [key, value] of Object.entries(payload)) {
    const here = path ? `${path}.${key}` : key;
    if (SECRET_KEY_RE.test(key)) {
      throw new Error(`job payload rejected: secret-shaped key "${here}" (store references, not credentials)`);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assertPayloadSafe(value as Record<string, unknown>, here);
    }
  }
}
