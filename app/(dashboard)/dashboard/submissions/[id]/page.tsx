/**
 * Submission detail — the full record of one submit: form answers, each file
 * with its destination link, and the per-channel delivery log. The owner can
 * change status and re-run delivery here.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, CheckCircle2, XCircle, Clock, Table2 } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { SubmissionStatusControl } from "@/components/submission-status-control";
import { SubmissionRetryButton } from "@/components/submission-retry-button";
import { requireUser } from "@/lib/auth";
import { getSubmissionDetail, type SubmissionDetail } from "@/lib/submissions";
import { resultUrlFor, resultUrlLabel } from "@/lib/result-url";
import { formatBytes, fileCategory } from "@/lib/upload-validation";
import type { NotificationDeliveryRow } from "@/lib/db-types";

export const dynamic = "force-dynamic";

export default async function SubmissionDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  let detail: SubmissionDetail | null = null;
  try {
    detail = await getSubmissionDetail(user.id, params.id);
  } catch {
    detail = null;
  }
  if (!detail) notFound();

  const { submission, linkName, files, deliveries, airtable } = detail;
  const who = submission.uploader_name || submission.uploader_email || "Anonymous";

  return (
    <>
      <Topbar email={user.email} title="Submission" />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/dashboard/submissions"
            className="mb-6 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 dark:hover:text-ink-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to submissions
          </Link>

          {/* Header */}
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-semibold">{who}</h2>
              <p className="mt-1 text-sm text-ink-500">
                {linkName} · {formatDateTime(submission.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SubmissionStatusControl submissionId={submission.id} initialStatus={submission.status} />
              <SubmissionRetryButton submissionId={submission.id} />
            </div>
          </div>

          {/* Form answers */}
          <section className="card mb-4">
            <h3 className="mb-3 font-display text-sm font-semibold">Details</h3>
            <dl className="space-y-2 text-sm">
              {submission.uploader_name && <Row label="Name" value={submission.uploader_name} />}
              {submission.uploader_email && <Row label="Email" value={submission.uploader_email} />}
              {submission.uploader_message && (
                <Row label="Message" value={submission.uploader_message} />
              )}
              {submission.custom_data &&
                Object.entries(submission.custom_data).map(([label, value]) =>
                  value ? <Row key={label} label={label} value={String(value)} /> : null,
                )}
              {!submission.uploader_name &&
                !submission.uploader_email &&
                !submission.uploader_message &&
                (!submission.custom_data || Object.keys(submission.custom_data).length === 0) && (
                  <p className="text-ink-400">No form fields were submitted.</p>
                )}
            </dl>
          </section>

          {/* Files */}
          <section className="card mb-4">
            <h3 className="mb-3 font-display text-sm font-semibold">
              {files.length} {files.length === 1 ? "file" : "files"}
            </h3>
            {files.length === 0 ? (
              <p className="text-sm text-ink-400">No files in this submission.</p>
            ) : (
              <ul className="space-y-2">
                {files.map((f) => {
                  const url = resultUrlFor(f.provider, f.providerFileId);
                  return (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2 dark:border-ink-800"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <FileStatusIcon status={f.status} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{f.originalFilename}</p>
                          <p className="text-xs text-ink-400">
                            <span className="capitalize">{fileCategory(f.mimeType)}</span>
                            {f.fileSizeBytes != null && ` · ${formatBytes(f.fileSizeBytes)}`}
                          </p>
                        </div>
                      </div>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary h-8 text-xs"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {resultUrlLabel(f.provider)}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Airtable record (when this submission created/updated one) */}
          {airtable && (
            <section className="card mb-4">
              <h3 className="mb-3 font-display text-sm font-semibold">Airtable record</h3>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2 dark:border-ink-800">
                <div className="flex min-w-0 items-center gap-2">
                  <Table2 className="h-4 w-4 flex-shrink-0 text-ink-400" />
                  <code className="truncate text-xs text-ink-500">{airtable.recordId}</code>
                </div>
                {airtable.url && (
                  <a
                    href={airtable.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary h-8 text-xs"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View in Airtable
                  </a>
                )}
              </div>
            </section>
          )}

          {/* Delivery log */}
          <section className="card">
            <h3 className="mb-3 font-display text-sm font-semibold">Delivery log</h3>
            {deliveries.length === 0 ? (
              <p className="text-sm text-ink-400">No delivery attempts recorded for this submission.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <DeliveryStatusBadge status={d.status} />
                    <span className="font-medium capitalize">{d.channel}</span>
                    {d.target && <span className="text-ink-500">&rarr; {d.target}</span>}
                    {d.detail && <span className="text-ink-400">· {d.detail}</span>}
                    <span className="ml-auto whitespace-nowrap text-ink-400">
                      {formatDateTime(d.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="w-32 flex-shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink-900 dark:text-ink-100">{value}</dd>
    </div>
  );
}

function FileStatusIcon({ status }: { status: "uploading" | "complete" | "failed" }) {
  if (status === "complete") return <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 flex-shrink-0 text-red-500" />;
  return <Clock className="h-4 w-4 flex-shrink-0 text-ink-400" />;
}

function DeliveryStatusBadge({ status }: { status: NotificationDeliveryRow["status"] }) {
  const styles =
    status === "sent"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100"
      : status === "failed"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-100"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100";
  return <span className={`rounded px-1.5 py-0.5 font-medium capitalize ${styles}`}>{status}</span>;
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
