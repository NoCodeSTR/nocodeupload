/**
 * Quo (formerly OpenPhone) SMS sending.
 *
 *   POST https://api.openphone.com/v1/messages
 *   Authorization: <API key>            (raw key — NOT a Bearer token)
 *   Body: { content, from: "+1…", to: ["+1…"] }
 *
 * `from` is the owner's own Quo number; the API key is generated in their Quo
 * workspace settings. Sending to US numbers requires the owner's Quo account to
 * have completed A2P carrier registration. Best-effort; never throws.
 */
import "server-only";

const MESSAGES_URL = "https://api.openphone.com/v1/messages";

export async function sendQuoMessage(args: {
  apiKey: string;
  from: string;
  to: string;
  content: string;
}): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        Authorization: args.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: args.content.slice(0, 1500),
        from: args.from,
        to: [args.to],
      }),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    // Surface a useful reason from the API error body when present.
    let detail = `responded ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; errors?: Array<{ message?: string }> };
      const msg = body.message || body.errors?.[0]?.message;
      if (msg) detail = `${res.status}: ${msg}`;
    } catch {
      /* ignore parse errors */
    }
    return { ok: false, detail };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "send failed" };
  }
}
