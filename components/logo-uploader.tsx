"use client";

/**
 * Company-logo uploader for Settings. Uploads to /api/account/logo (which
 * stores it in Supabase Storage and saves the URL on the profile). Shows the
 * current logo with a replace/remove control.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";

interface LogoUploaderProps {
  currentLogoUrl: string | null;
}

export function LogoUploader({ currentLogoUrl }: LogoUploaderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(currentLogoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch("/api/account/logo", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed.");
      const body = (await res.json()) as { logoUrl: string };
      setLogoUrl(body.logoUrl);
      router.refresh();
    } catch {
      setError("Couldn't upload the logo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/logo", { method: "DELETE" });
      if (!res.ok) throw new Error("Remove failed.");
      setLogoUrl(null);
      router.refresh();
    } catch {
      setError("Couldn't remove the logo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 className="font-display text-base font-semibold">Company logo</h3>
      <p className="mt-1 text-sm text-ink-500">
        Shown on your upload pages and in notification emails. PNG, JPG, WebP, or SVG, up to 2 MB.
      </p>

      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-900">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Company logo" className="h-full w-full object-contain" />
          ) : (
            <ImagePlus className="h-6 w-6 text-ink-400" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Working…" : logoUrl ? "Replace logo" : "Upload logo"}
          </button>
          {logoUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="btn-ghost h-9 px-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30"
              aria-label="Remove logo"
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

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
