"use client";

/**
 * Settings → Notification destinations. Reusable channels an owner can route
 * uploads to via per-link rules:
 *   - email  : an address (added here)
 *   - slack  : a channel (connected via OAuth)
 *   - quo    : SMS via Quo/OpenPhone (API key + from/to numbers, added here)
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Slack, MessageSquare, Trash2 } from "lucide-react";

export interface DestinationSummary {
  id: string;
  type: "email" | "slack" | "quo";
  label: string;
  detail: string | null;
}

type AddMode = null | "email" | "quo";

export function DestinationsManager({
  destinations,
  slackConfigured = false,
}: {
  destinations: DestinationSummary[];
  slackConfigured?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<AddMode>(null);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [toNumber, setToNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode(null);
    setLabel("");
    setAddress("");
    setApiKey("");
    setFromNumber("");
    setToNumber("");
    setError(null);
  }

  function submit() {
    setError(null);
    const body =
      mode === "quo"
        ? { type: "quo", label: label.trim(), apiKey: apiKey.trim(), fromNumber: fromNumber.trim(), toNumber: toNumber.trim() }
        : { type: "email", label: label.trim(), address: address.trim() };

    if (mode === "email" && (!label.trim() || !address.trim())) {
      setError("Add a label and an email address.");
      return;
    }
    if (mode === "quo" && (!label.trim() || !apiKey.trim() || !fromNumber.trim() || !toNumber.trim())) {
      setError("Add a label, API key, from-number, and to-number.");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/notifications/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(
          mode === "quo"
            ? "Couldn't add that — check the API key and that numbers are in +15555550123 format."
            : "Couldn't add that destination — check the email address.",
        );
        return;
      }
      reset();
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await fetch(`/api/notifications/destinations/${id}`, { method: "DELETE" }).catch(() => {});
      router.refresh();
    });
  }

  function iconFor(type: DestinationSummary["type"]) {
    if (type === "slack") return <Slack className="h-4 w-4" />;
    if (type === "quo") return <MessageSquare className="h-4 w-4" />;
    return <Mail className="h-4 w-4" />;
  }

  return (
    <div className="space-y-3">
      {destinations.length > 0 && (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200 dark:divide-ink-800 dark:border-ink-700">
          {destinations.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-ink-100 dark:bg-ink-900">
                {iconFor(d.type)}
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

      {mode === "email" && (
        <div className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Maintenance team)" maxLength={80} />
          <input className="input" type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="name@example.com" />
          {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
          <FormButtons onSave={submit} onCancel={reset} pending={isPending} />
        </div>
      )}

      {mode === "quo" && (
        <div className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Text my cell)" maxLength={80} />
          <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Quo API key (Quo → Settings → API)" />
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="From (your Quo #) +15555550123" />
            <input className="input" value={toNumber} onChange={(e) => setToNumber(e.target.value)} placeholder="To (recipient) +15555550123" />
          </div>
          <p className="text-xs text-ink-400">
            Texts send from your own Quo number. US numbers require A2P carrier registration on
            your Quo account.
          </p>
          {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
          <FormButtons onSave={submit} onCancel={reset} pending={isPending} />
        </div>
      )}

      {mode === null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode("email")} className="btn-secondary text-sm">
            <Mail className="h-4 w-4" />
            Add email
          </button>
          <button type="button" onClick={() => setMode("quo")} className="btn-secondary text-sm">
            <MessageSquare className="h-4 w-4" />
            Add SMS (Quo)
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

function FormButtons({ onSave, onCancel, pending }: { onSave: () => void; onCancel: () => void; pending: boolean }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onSave} disabled={pending} className="btn-primary h-8 text-xs">
        {pending ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={onCancel} className="btn-ghost h-8 text-xs">
        Cancel
      </button>
    </div>
  );
}
