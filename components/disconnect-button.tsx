"use client";

/**
 * Small confirm-then-DELETE button used in the Settings page connection list.
 * Kept in its own file so the Settings page stays a server component.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface DisconnectButtonProps {
  connectionId: string;
  label: string;
}

export function DisconnectButton({ connectionId, label }: DisconnectButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    if (
      !window.confirm(
        `Disconnect ${label}? Upload links using this account will need to be re-pointed.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await fetch(`/api/connections/${connectionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to disconnect." }));
        setError(body.error ?? "Failed to disconnect.");
        return;
      }
      // Server data changed — refresh the route segment so the list updates.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="btn-secondary h-8 text-xs"
      >
        {isPending ? "…" : "Disconnect"}
      </button>
      {error && (
        <span className="max-w-[20rem] text-right text-xs text-red-600 dark:text-red-300">
          {error}
        </span>
      )}
    </div>
  );
}
