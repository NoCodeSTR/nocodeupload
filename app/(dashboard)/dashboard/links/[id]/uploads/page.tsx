/**
 * Submissions view — every upload sent to one link, with the uploader's
 * name/email/message, file details, status, and an open-in-Drive link.
 * Surfaces the metadata captured at upload time (including the message).
 */
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileUp, ExternalLink, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { requireUser } from "@/lib/auth";
import { getLinkForUser } from "@/lib/links";
import { listUploadsForLink } from "@/lib/uploads";
import { formatBytes, fileCategory } from "@/lib/upload-validation";
import { resultUrlFor, resultUrlLabel } from "@/lib/result-url";
import { listDeliveriesForLink } from "@/lib/notifications/deliveries";
import type { UploadRow, NotificationDeliveryRow } from "@/lib/db-types";

export const dynamic = "force-dynamic";

export default async function LinkUploadsPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const link = await getLinkForUser({ userId: user.id, linkId: params.id });
  if (!link) notFound();

  let uploads: UploadRow[] = [];
  let loadError = false;
  try {
    uploads = await listUploadsForLink({ userId: user.id, linkId: params.id });
  } catch {
    loadError = true;
  }

  const completed = uploads.filter((u) => u.status === "complete");

  // Count files per batch so we can badge grouped uploads ("Batch of 7").
  const batchCounts = new Map<string, number>();
  for (const u of uploads) {
    if (u.batch_id) batchCounts.set(u.batch_id, (batchCounts.get(u.batch_id) ?? 0) + 1);
  }

  // Recent notification delivery attempts (observability).
  let deliveries: NotificationDeliveryRow[] = [];
  try {
    deliveries = await listDeliveriesForLink({ userId: user.id, linkId: params.id, limit: 12 });
  } catch {
    /* non-fatal */
  }

  return (
    <>
      <Topbar email={user.email} title="Submissions" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/dashboard"
            className="mb-6 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 dark:hover:text-ink-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to links
          </Link>

          <div className="mb-6">
            <h2 className="font-display text-xl font-semibold">{link.name}</h2>
            <p className="mt-1 text-sm text-ink-500">
              {completed.length} {completed.length === 1 ? "file" : "files"} received
              {link.folder_name ? ` · ${link.folder_name}` : ""}
            </p>
          </div>

          {loadError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              Couldn&apos;t load submissions just now — refresh in a moment.
            </div>
          )}

          {deliveries.length > 0 && (
            <div className="mb-6 rounded-lg border border-ink-200 p-4 dark:border-ink-700">
              <h3 className="mb-2 font-display text-sm font-semibold">Recent notifications</h3>
              <ul className="space-y-1.5 text-xs">
                {deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <DeliveryStatusBadge status={d.status} />
                    <span className="font-medium capitalize">{d.channel}</span>
                    {d.target && <span className="text-ink-500">&rarr; {d.target}</span>}
                    {d.detail && <span className="text-ink-400">· {d.detail}</span>}
                    <span className="ml-auto text-ink-400">{formatDateTime(d.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {uploads.length === 0 && !loadError ? (
            <div className="card flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-100">
                <FileUp className="h-6 w-6" />
              </div>
              <h3 className="mb-1 font-display text-lg font-semibold">No uploads yet</h3>
              <p className="max-w-md text-sm text-ink-500">
                When someone uploads through this link, their files and details show up here.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {uploads.map((u) => (
                <UploadRowCard
                  key={u.id}
                  upload={u}
                  batchCount={u.batch_id ? batchCounts.get(u.batch_id) : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}

function UploadRowCard({ upload, batchCount }: { upload: UploadRow; batchCount?: number }) {
  // Provider-aware "open" URL — Drive file view or YouTube watch page.
  const openUrl = resultUrlFor(upload.provider, upload.provider_file_id);
  const openLabel = resultUrlLabel(upload.provider);

  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusIcon status={upload.status} />
            <h3 className="truncate font-medium">{upload.original_filename}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
            <span className="rounded bg-ink-100 px-1.5 py-0.5 capitalize text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              {fileCategory(upload.mime_type)}
            </span>
            {batchCount && batchCount > 1 && (
              <span
                title={upload.batch_id ?? undefined}
                className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
              >
                Batch of {batchCount}
              </span>
            )}
            {upload.file_size_bytes != null && <span>{formatBytes(upload.file_size_bytes)}</span>}
            <span>{formatDateTime(upload.created_at)}</span>
          </div>

          {(upload.uploader_name || upload.uploader_email || upload.uploader_message) && (
            <div className="mt-3 space-y-1 rounded-lg bg-ink-50 px-3 py-2 text-sm dark:bg-ink-900/60">
              {(upload.uploader_name || upload.uploader_email) && (
                <p className="text-ink-700 dark:text-ink-200">
                  <span className="font-medium">{upload.uploader_name ?? "Anonymous"}</span>
                  {upload.uploader_email && (
                    <span className="text-ink-400"> · {upload.uploader_email}</span>
                  )}
                </p>
              )}
              {upload.uploader_message && (
                <p className="text-ink-600 dark:text-ink-300">“{upload.uploader_message}”</p>
              )}
            </div>
          )}

          {upload.custom_data && Object.keys(upload.custom_data).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(upload.custom_data).map(([label, value]) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
                >
                  <span className="font-medium">{label}:</span> {String(value)}
                </span>
              ))}
            </div>
          )}

          {upload.status === "failed" && upload.error_message && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-300">{upload.error_message}</p>
          )}
        </div>

        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary h-8 text-xs"
          >
            <ExternalLink className="h-4 w-4" />
            {openLabel}
          </a>
        )}
      </div>
    </li>
  );
}

function DeliveryStatusBadge({ status }: { status: NotificationDeliveryRow["status"] }) {
  const styles =
    status === "sent"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100"
      : status === "failed"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-100"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100";
  return (
    <span className={`rounded px-1.5 py-0.5 font-medium capitalize ${styles}`}>{status}</span>
  );
}

function StatusIcon({ status }: { status: UploadRow["status"] }) {
  if (status === "complete") return <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 flex-shrink-0 text-red-500" />;
  return <Clock className="h-4 w-4 flex-shrink-0 text-ink-400" />;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
