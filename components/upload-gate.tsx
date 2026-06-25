"use client";

/**
 * Password gate for a protected upload link. Renders ONLY the brand header,
 * link name, and a password prompt — the upload form and its custom fields are
 * not fetched until the password is verified by /api/upload/unlock.
 * On success we render the real UploadCard with the returned config and pass the
 * verified password through so the uploader doesn't re-enter it.
 */
import { useState } from "react";
import { Upload, Lock } from "lucide-react";
import { UploadCard } from "@/components/upload-card";
import type { UploadLinkPublicRow } from "@/lib/db-types";

export function UploadGate({
  slug,
  name,
  accent,
  brandingLogoUrl,
  showBrandHeader = true,
  prefill = {},
  recordId = null,
}: {
  slug: string;
  name: string;
  accent: string;
  brandingLogoUrl: string | null;
  showBrandHeader?: boolean;
  prefill?: Record<string, string>;
  recordId?: string | null;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [config, setConfig] = useState<UploadLinkPublicRow | null>(null);

  // Verified → hand off to the real form, passing the password through.
  if (config) {
    return (
      <UploadCard
        link={config}
        showBrandHeader={showBrandHeader}
        unlockedPassword={password}
        prefill={prefill}
        recordId={recordId}
      />
    );
  }

  async function unlock() {
    if (!password.trim()) {
      setError("Enter the password to continue.");
      return;
    }
    setError(null);
    setUnlocking(true);
    try {
      const res = await fetch("/api/upload/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password: password.trim() }),
      });
      if (res.status === 403) {
        setError("Incorrect password. Check with whoever shared this link.");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }
      const data = (await res.json()) as { link: UploadLinkPublicRow };
      setConfig(data.link);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <>
      {showBrandHeader && (
        <div className="mb-6 flex items-center justify-center">
          {brandingLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandingLogoUrl} alt="" className="h-12 object-contain" />
          ) : (
            <div className="flex items-center gap-2 font-display text-lg font-bold">
              <Upload className="h-6 w-6" style={{ color: accent }} />
              NoCode Upload
            </div>
          )}
        </div>
      )}

      <div className="card">
        {!showBrandHeader && brandingLogoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brandingLogoUrl} alt="" className="mb-4 h-10 object-contain" />
        )}

        <h1 className="font-display text-2xl font-bold">{name}</h1>

        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2 text-sm text-ink-500">
            <Lock className="h-4 w-4" />
            This upload link is password protected.
          </div>
          <label className="label mb-1" htmlFor="gate-password">
            Password
          </label>
          <input
            id="gate-password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") unlock();
            }}
            placeholder="Enter the password"
            disabled={unlocking}
            autoComplete="off"
            autoFocus
          />
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
          <button
            type="button"
            onClick={unlock}
            disabled={unlocking}
            className="btn mt-4 w-full text-white"
            style={{ backgroundColor: accent }}
          >
            {unlocking ? "Checking…" : "Continue"}
          </button>
        </div>
      </div>
    </>
  );
}
