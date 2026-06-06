"use client";

/**
 * Settings → Notification destinations. Reusable channels an owner can route
 * uploads to via per-link rules. A-1 supports email addresses; Slack connects
 * via OAuth in the next update (shown as a disabled affordance for now).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Slack, Trash2 } from "lucide-react";

export interface DestinationSummary {
  id: string;
  type: "email" | "slack";
  label: string;
  detail: string | null;
}

export function DestinationsManager({
  destinations,
  slackConfigured = false,
}: {
  destinations: DestinationSummary[];
  slackConfigured?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (!label.trim() || !address.trim()) {
      setError("Add a label and an email address.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/notifications/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email", label: label.trim(), address: address.trim() }),
      });
      if (!res.ok) {
        setError("Couldn't add that destination — check the email address.");
        return;
      }
      setLabel("");
      setAddress("");
      setAdding(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await fetch(`/api/notifications/destinations/${id}`, { method: "DELETE" }).catch(() => {});
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {destinations.length > 0 && (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200 dark:divide-ink-800 dark:border-ink-700">
          {destinations.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-ink-100 dark:bg-ink-900">
                {d.type === "slack" ? <Slack className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.label}</p>
                {d.detail && <p className="truncate text-xs text-ink-500">{d.detail}</p>}
              </div>
              <button
                type="button"
                onClick={() => remove(d.id)}
                disabled={isPending}
                className="btn-ghost h-8 px-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30"
                aria-label="Remove destination"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Maintenance team)"
            maxLength={80}
          />
          <input
            className="input"
            type="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="name@example.com"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={add} disabled={isPending} className="btn-primary h-8 text-xs">
              {isPending ? "Adding…" : "Add"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="btn-ghost h-8 text-xs">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAdding(true)} className="btn-secondary text-sm">
            <Mail className="h-4 w-4" />
            Add email destination
          </button>
          {slackConfigured ? (
            <a href="/api/slack/connect" className="btn-secondary text-sm">
              <Slack className="h-4 w-4" />
              Connect Slack
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to enable Slack"
              className="btn-secondary cursor-not-allowed text-sm opacity-50"
            >
              <Slack className="h-4 w-4" />
              Connect Slack (not configured)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
