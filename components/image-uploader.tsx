"use client";

/**
 * Small reusable image uploader — posts to /api/images and returns a public URL
 * via onUploaded. Shows a thumbnail of the current value with a Replace/Remove
 * control. Used for upload-box reference photos.
 */
import { useRef, useState } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";

export function ImageUploader({
  value,
  onChange,
  label = "Reference photo",
}: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/images", { method: "POST", body: fd });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { reason?: string };
        throw new Error(b.reason === "size" ? "Image must be under 5 MB." : "Couldn't upload that image.");
      }
      const { url } = (await res.json()) as { url: string };
      onChange(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="label mb-1 block">
        {label} <span className="font-normal text-ink-400">(optional)</span>
      </span>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-14 w-14 rounded-lg border border-ink-200 object-cover dark:border-ink-700" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-ink-300 text-ink-400 dark:border-ink-700">
            <ImagePlus className="h-5 w-5" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="btn-secondary h-8 text-xs"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {value ? "Replace" : "Upload"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="btn-ghost h-8 px-2 text-xs text-red-600 dark:text-red-300"
            >
              <X className="h-4 w-4" />
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {value && (
        <p className="mt-1 text-xs text-ink-400">Shown to uploaders above this box as an example to match.</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
