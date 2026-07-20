/**
 * Webhook failure classification (Jobs Engine Phase 1). Pure — no imports —
 * so it's directly unit-testable and shared by the sender and the handler.
 *
 * Retryable: 5xx, 408 (timeout), 429 (with Retry-After passthrough), and
 * transport errors (network/abort). Permanent: every other 4xx — the
 * receiver understood us and said no; retrying can't fix their answer.
 */
export interface WebhookRetryInfo {
  retryable: boolean;
  retryAfterMs?: number;
}

export function classifyHttpFailure(
  status: number,
  retryAfterHeader?: string | null,
): WebhookRetryInfo {
  if (status >= 500 || status === 408 || status === 429) {
    return { retryable: true, retryAfterMs: parseRetryAfterMs(retryAfterHeader) };
  }
  return { retryable: false };
}

/** Transport-level failures (fetch threw: DNS, refused, aborted timeout). */
export const TRANSPORT_FAILURE: WebhookRetryInfo = { retryable: true };

export function parseRetryAfterMs(header?: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}
