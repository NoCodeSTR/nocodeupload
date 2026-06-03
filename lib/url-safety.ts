/**
 * SSRF guard for user-provided outbound URLs (webhooks).
 *
 * The webhook URL is set by hosts and POSTed to by our server, so a malicious
 * value (http://169.254.169.254/, http://localhost/admin, an internal RFC1918
 * address) could be used to probe internal infrastructure or cloud metadata.
 * This blocks the obvious offenders: requires https, and rejects loopback /
 * private / link-local / CGNAT / metadata hosts by literal inspection.
 *
 * Residual risk: a hostname that DNS-resolves to a private IP (DNS rebinding)
 * isn't caught here. A future hardening step is to resolve the host and check
 * the resolved address before each send. For MVP this literal guard removes
 * the easy attack surface.
 */

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
}

export function isPubliclySafeHttpUrl(raw: string): UrlSafetyResult {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { safe: false, reason: "That doesn't look like a valid URL." };
  }

  if (u.protocol !== "https:") {
    return { safe: false, reason: "Webhook URLs must start with https://." };
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Blocked hostnames.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata" ||
    host === "metadata.google.internal"
  ) {
    return { safe: false, reason: "Internal hostnames aren't allowed." };
  }

  // IPv6 literals: loopback (::1), unique-local (fc00::/7 → fc/fd),
  // link-local (fe80::/10 → fe8/fe9/fea/feb).
  if (host.includes(":")) {
    if (
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb")
    ) {
      return { safe: false, reason: "Private IPv6 addresses aren't allowed." };
    }
  }

  // IPv4 literals.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const privateV4 =
      a === 0 || // "this" network
      a === 10 || // private
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local + cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127); // CGNAT
    if (privateV4) {
      return { safe: false, reason: "Private IP addresses aren't allowed." };
    }
  }

  return { safe: true };
}
