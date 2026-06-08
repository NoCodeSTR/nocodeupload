"use client";

/**
 * Airtable connection card for Settings. Connect by pasting a Personal Access
 * Token (validated server-side before it's stored, encrypted). Once connected,
 * links can route uploads into an Airtable table (base/table/field mapping is
 * configured per link in the link form).
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Table2, Check, AlertCircle, ExternalLink } from "lucide-react";

interface AirtableConnectionProps {
  connected: boolean;
}

export function AirtableConnection({ connected }: AirtableConnectionProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    const t = token.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/airtable/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(
          body.detail ??
            (body.error === "invalid_token"
              ? "Airtable rejected that token."
              : "Couldn't connect Airtable."),
        );
      }
      setToken("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect Airtable.");
    } finally {
      setBusy(false);
    }
  }, [token, router]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/airtable/connect", { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't disconnect.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't disconnect.");
    } finally {
      setBusy(false);
    }
  }, [router]);

  return (
    <div className="card">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-ink-100 dark:bg-ink-900">
          <Table2 className="h-5 w-5 text-ink-700 dark:text-ink-200" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-display text-base font-semibold">Airtable</h3>
            {connected ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-100">
                <Check className="h-3 w-3" />
                Connected
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Create a row in an Airtable table on every upload — with the file link, the uploader&apos;s
            answers, and (optionally) the file itself as an attachment. Set up the base, table, and
            field mapping per link in the link form.
          </p>

          {connected ? (
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-ink-200 pt-4 dark:border-ink-700">
              <p className="text-sm text-ink-600 dark:text-ink-300">
                Your Airtable account is connected.
              </p>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                className="btn-ghost h-8 text-xs text-red-600 dark:text-red-300"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-2 border-t border-ink-200 pt-4 dark:border-ink-700">
              <label className="label" htmlFor="airtable-pat">
                Personal Access Token
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="airtable-pat"
                  type="password"
                  className="input flex-1"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void connect();
                    }
                  }}
                  placeholder="pat••••••••••••••••"
                  autoComplete="off"
                />
                <button type="button" onClick={connect} disabled={busy} className="btn-primary text-sm">
                  {busy ? "Connecting…" : "Connect"}
                </button>
              </div>
              <p className="text-xs text-ink-400">
                Create a token at{" "}
                <a
                  href="https://airtable.com/create/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-brand hover:underline"
                >
                  airtable.com/create/tokens
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                with scopes <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">data.records:write</code>{" "}
                and <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">schema.bases:read</code>, and
                grant it access to your base.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
