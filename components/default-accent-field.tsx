"use client";

/**
 * Settings control for the account-level default accent color. Saves to
 * profiles.default_accent_color via /api/account/accent. New upload links seed
 * their brand color from this (still overridable per link).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AccentColorInput } from "@/components/accent-color-input";

const FALLBACK = "#2563eb";

export function DefaultAccentField({ currentColor }: { currentColor: string | null }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(Boolean(currentColor));
  const [color, setColor] = useState(currentColor ?? FALLBACK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = enabled
        ? await fetch("/api/account/accent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ color }),
          })
        : await fetch("/api/account/accent", { method: "DELETE" });
      if (!res.ok) throw new Error("save_failed");
      router.refresh();
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Set a default brand color for new forms
      </label>
      {enabled && <AccentColorInput value={color} onChange={setColor} />}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="btn-secondary text-sm">
          {busy ? "Saving…" : "Save default color"}
        </button>
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
      <p className="text-xs text-ink-500">
        New upload links start with this color. You can still change it on any individual link.
      </p>
    </div>
  );
}
