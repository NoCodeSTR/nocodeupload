"use client";

/**
 * Brand mark used in app headers. Renders /logo.png if present, otherwise
 * gracefully falls back to the icon + "NoCode Upload" wordmark — so dropping a
 * logo file into public/logo.png lights it up app-wide with zero code changes,
 * and nothing breaks before that file exists.
 *
 * (We can't bundle the AI-generated logo from chat directly; add the file to
 * public/logo.png — or replace it anytime — and this picks it up.)
 */
import { useState } from "react";
import { Upload } from "lucide-react";

export function BrandLogo({ imgClassName = "h-8 w-auto" }: { imgClassName?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="flex items-center gap-2 font-display text-lg font-bold">
        <Upload className="h-6 w-6 text-brand" />
        NoCode Upload
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="NoCode Upload"
      className={imgClassName}
      onError={() => setFailed(true)}
    />
  );
}
