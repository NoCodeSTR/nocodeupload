"use client";

/**
 * Status dropdown for a submission (new / in progress / done / archived).
 * PATCHes /api/submissions/[id] and refreshes so the badge updates everywhere.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "new" | "in_progress" | "done" | "archived";

const LABELS: Record<Status, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
  archived: "Archived",
};

export function SubmissionStatusControl({
  submissionId,
  initialStatus,
}: {
  submissionId: string;
  initialStatus: Status;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [busy, setBusy] = useState(false);

  async function change(next: Status) {
    const prev = status;
    setStatus(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("failed");
      router.refresh();
    } catch {
      setStatus(prev); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className="input h-8 w-auto py-0 text-sm"
      value={status}
      disabled={busy}
      onChange={(e) => change(e.target.value as Status)}
      aria-label="Submission status"
    >
      {(Object.keys(LABELS) as Status[]).map((s) => (
        <option key={s} value={s}>
          {LABELS[s]}
        </option>
      ))}
    </select>
  );
}
