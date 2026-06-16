"use client";

/**
 * Copy-to-clipboard button for a submission's public share link. Server passes
 * the resolved share URL; this just handles the copy + a brief "Copied!" state.
 */
import { useState } from "react";
import { Link2, Check } from "lucide-react";

export function ShareLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be blocked; fall back to a prompt so the URL is still grabbable.
      window.prompt("Copy this share link:", url);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" onClick={copy} className="btn-secondary h-8 text-xs" title="Copy a public link to this submission">
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
      {copied ? "Copied!" : "Copy share link"}
    </button>
  );
}
