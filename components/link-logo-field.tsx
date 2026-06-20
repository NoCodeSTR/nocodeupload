"use client";

/**
 * Per-link logo override. Uploads to /api/branding/logo (which returns a public
 * URL without touching the account logo) and reports the URL up to the link
 * form. Empty = the link falls back to the account's default logo.
 */
import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

interface LinkLogoFieldProps {
  value: string | null;
  onChange: (url: string | null) => void;
  /** The account logo, shown as the fallback preview when no override is set. */
  fallbackUrl?: string | null;
}

export function LinkLogoField({ value, onChange, fallbackUrl = null }: LinkLogoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = value || fallbackUrl;
  const usingFallback = !value && Boolean(fallbackUrl);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be 2 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/branding/logo", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed.");
      const body = (await res.json()) as { url: string };
      onChange(body.url);
    } catch {
      setError("Couldn't upload the logo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="label mb-1 block">
        Logo <span className="font-normal text-ink-400">(optional — overrides your account logo)</span>
      </span>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-900">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-contain" />
          ) : (
            <ImagePlus className="h-5 w-5 text-ink-400" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Uploading…" : value ? "Replace logo" : "Upload a logo"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="btn-ghost h-9 px-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30"
              aria-label="Use the account logo instead"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-400">
        {usingFallback
          ? "Using your account logo. Upload one to override it for this form."
          : value
            ? "This form uses its own logo."
            : "Defaults to your account logo (set in Settings)."}
      </p>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
