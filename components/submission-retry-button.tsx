"use client";

/**
 * Re-run delivery for a submission. Confirms first, since re-running dispatch
 * re-sends to all matched destinations (the per-attempt log doesn't carry the
 * secrets needed to re-send a single channel). Airtable is only re-created if it
 * failed and never succeeded.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, AlertCircle } from "lucide-react";

export function SubmissionRetryButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function retry() {
    if (state === "busy") return;
    const ok = window.confirm(
      "Re-run delivery for this submission? This re-sends its notifications to every matched destination, and re-creates the Airtable record if it had failed.",
    );
    if (!ok) return;
    setState("busy");
    try {
      const res = await fetch(`/api/submissions/${submissionId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      setState("done");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      onClick={retry}
      disabled={state === "busy"}
      className="btn-secondary h-8 text-xs"
    >
      {state === "busy" ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          Re-running…
        </>
      ) : state === "done" ? (
        <>
          <Check className="h-4 w-4 text-green-600" />
          Re-ran delivery
        </>
      ) : state === "error" ? (
        <>
          <AlertCircle className="h-4 w-4 text-red-600" />
          Failed — try again
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4" />
          Re-run delivery
        </>
      )}
    </button>
  );
}
