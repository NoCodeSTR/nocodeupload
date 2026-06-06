"use client";

/**
 * Settings → Notification destinations. Reusable channels routed to via per-link
 * rules:
 *   - email : an address (added here)
 *   - slack : a channel in a connected workspace, with an optional @mention
 *             (connect once via OAuth, then pick channel + person from dropdowns)
 *   - quo   : SMS via Quo/OpenPhone (API key + from/to numbers)
 */
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Mail, Slack, MessageSquare, Trash2 } from "lucide-react";

export interface DestinationSummary {
  id: string;
  type: "email" | "slack" | "quo";
  label: string;
  detail: string | null;
}

export interface SlackConnectionSummary {
  id: string;
  teamName: string | null;
}

type AddMode = null | "email" | "quo" | "slack";

interface SlackOption {
  id: string;
  name: string;
}

export function DestinationsManager({
  destinations,
  slackConfigured = false,
  slackConnections = [],
}: {
  destinations: DestinationSummary[];
  slackConfigured?: boolean;
  slackConnections?: SlackConnectionSummary[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<AddMode>(null);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [toNumber, setToNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Slack picker state
  const [slackConnectionId, setSlackConnectionId] = useState(slackConnections[0]?.id ?? "");
  const [channels, setChannels] = useState<SlackOption[]>([]);
  const [users, setUsers] = useState<SlackOption[]>([]);
  const [channelId, setChannelId] = useState("");
  const [mentionUserId, setMentionUserId] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(false);

  const loadSlackOptions = useCallback(async (connectionId: string) => {
    if (!connectionId) return;
    setLoadingOptions(true);
    setError(null);
    try {
      const res = await fetch(`/api/slack/options?connectionId=${connectionId}`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { channels: SlackOption[]; users: SlackOption[] };
      setChannels(data.channels ?? []);
      setUsers(data.users ?? []);
    } catch {
      setError("Couldn't load Slack channels — try reconnecting Slack.");
      setChannels([]);
      setUsers([]);
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "slack" && slackConnectionId) void loadSlackOptions(slackConnectionId);
  }, [mode, slackConnectionId, loadSlackOptions]);

  function reset() {
    setMode(null);
    setLabel("");
    setAddress("");
    setApiKey("");
    setFromNumber("");
    setToNumber("");
    setChannelId("");
    setMentionUserId("");
    setError(null);
  }

  async function post(body: Record<string, unknown>, failMsg: string) {
    setPending(true);
    try {
      const res = await fetch("/api/notifications/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(failMsg);
        return;
      }
      reset();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function submitEmail() {
    setError(null);
    if (!label.trim() || !address.trim()) return setError("Add a label and an email address.");
    void post({ type: "email", label: label.trim(), address: address.trim() }, "Couldn't add that — check the email address.");
  }

  function submitQuo() {
    setError(null);
    if (!label.trim() || !apiKey.trim() || !fromNumber.trim() || !toNumber.trim())
      return setError("Add a label, API key, from-number, and to-number.");
    void post(
      { type: "quo", label: label.trim(), apiKey: apiKey.trim(), fromNumber: fromNumber.trim(), toNumber: toNumber.trim() },
      "Couldn't add that — check the API key and that numbers are in +15555550123 format.",
    );
  }

  function submitSlack() {
    setError(null);
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return setError("Pick a channel.");
    const user = users.find((u) => u.id === mentionUserId);
    void post(
      {
        type: "slack",
        label: label.trim() || `#${channel.name}`,
        slackConnectionId,
        channelId: channel.id,
        channelName: channel.name,
        mentionUserId: user?.id ?? null,
        mentionUserName: user?.name ?? null,
      },
      "Couldn't add that Slack channel.",
    );
  }

  function remove(id: string) {
    setPending(true);
    fetch(`/api/notifications/destinations/${id}`, { method: "DELETE" })
      .catch(() => {})
      .finally(() => {
        setPending(false);
        router.refresh();
      });
  }

  function iconFor(type: DestinationSummary["type"]) {
    if (type === "slack") return <Slack className="h-4 w-4" />;
    if (type === "quo") return <MessageSquare className="h-4 w-4" />;
    return <Mail className="h-4 w-4" />;
  }

  const hasSlackConnection = slackConnections.length > 0;

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
                disabled={pending}
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
          <FormButtons onSave={submitEmail} onCancel={reset} pending={pending} />
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
            Texts send from your own Quo number. US numbers require A2P carrier registration on your Quo account.
          </p>
          {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
          <FormButtons onSave={submitQuo} onCancel={reset} pending={pending} />
        </div>
      )}

      {mode === "slack" && (
        <div className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          {slackConnections.length > 1 && (
            <select
              className="input"
              value={slackConnectionId}
              onChange={(e) => {
                setSlackConnectionId(e.target.value);
                setChannelId("");
                setMentionUserId("");
              }}
            >
              {slackConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.teamName ?? "Slack workspace"}
                </option>
              ))}
            </select>
          )}
          {loadingOptions ? (
            <p className="text-sm text-ink-500">Loading channels &amp; people…</p>
          ) : (
            <>
              <label className="label">Channel</label>
              <select className="input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                <option value="">Choose a channel…</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
              <label className="label">Mention a person <span className="font-normal text-ink-400">(optional)</span></label>
              <select className="input" value={mentionUserId} onChange={(e) => setMentionUserId(e.target.value)}>
                <option value="">No @mention</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    @{u.name}
                  </option>
                ))}
              </select>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional — defaults to the channel)" maxLength={80} />
            </>
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
          <FormButtons onSave={submitSlack} onCancel={reset} pending={pending || loadingOptions} />
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
          {!slackConfigured ? (
            <button
              type="button"
              disabled
              title="Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to enable Slack"
              className="btn-secondary cursor-not-allowed text-sm opacity-50"
            >
              <Slack className="h-4 w-4" />
              Slack (not configured)
            </button>
          ) : hasSlackConnection ? (
            <>
              <button type="button" onClick={() => setMode("slack")} className="btn-secondary text-sm">
                <Slack className="h-4 w-4" />
                Add Slack channel
              </button>
              <a href="/api/slack/connect" className="btn-ghost text-sm text-ink-500">
                Connect another workspace
              </a>
            </>
          ) : (
            <a href="/api/slack/connect" className="btn-secondary text-sm">
              <Slack className="h-4 w-4" />
              Connect Slack
            </a>
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
