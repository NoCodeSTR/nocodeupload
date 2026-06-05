"use client";

/**
 * Brand mark used in app headers: the cloud mark (public/logo-mark.png) paired
 * with a live-text "NoCode Upload" wordmark. Live text keeps the lockup crisp
 * at any size and theme-aware (the wordmark recolors for light/dark), while the
 * mark carries the distinctive cloud. If the mark file is missing we fall back
 * to a lucide cloud-upload icon so nothing breaks.
 *
 * Swap public/logo-mark.png anytime to update the mark app-wide.
 */
import { useState } from "react";
import { UploadCloud } from "lucide-react";

export function BrandLogo({ imgClassName = "h-8 w-auto" }: { imgClassName?: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex items-center gap-2">
      {failed ? (
        <UploadCloud className="h-7 w-7 text-brand" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo-mark.png"
          alt=""
          className={imgClassName}
          onError={() => setFailed(true)}
        />
      )}
      <span className="font-display text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">
        NoCode <span className="text-brand">Upload</span>
      </span>
    </span>
  );
}
