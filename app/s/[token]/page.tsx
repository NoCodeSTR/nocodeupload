/**
 * Public submission share page — /s/[token]
 *
 * A clean, branded, login-free page that shows a submission's uploaded files
 * (and optionally its form answers) to anyone the owner forwards the link to.
 * The token is an AES-GCM-signed submission id; files stream through the signed
 * /api/file proxy, so the owner's Drive stays private. 404s when the link's
 * share page is turned off (getShareView returns null).
 */
import { notFound } from "next/navigation";
import { ShieldCheck, FileIcon, Download, Play } from "lucide-react";
import { decryptFromToken } from "@/lib/crypto/tokens";
import { getShareView } from "@/lib/submissions";

export const dynamic = "force-dynamic";

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default async function SharePage({ params }: { params: { token: string } }) {
  let submissionId = "";
  try {
    submissionId = decryptFromToken(params.token).trim();
  } catch {
    // Malformed/forged token → fall through to the 404 below.
  }
  if (!submissionId) notFound();

  const view = await getShareView(submissionId);
  if (!view) notFound();

  const accent = view.brandingColor || "#2563eb";
  const dateStr = new Date(view.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Form answers (only when the owner opted into showing them).
  const answers: Array<{ label: string; value: string }> = [];
  if (view.mode === "files_and_answers") {
    if (view.uploaderName) answers.push({ label: "From", value: view.uploaderName });
    if (view.uploaderEmail) answers.push({ label: "Email", value: view.uploaderEmail });
    if (view.uploaderMessage) answers.push({ label: "Message", value: view.uploaderMessage });
    for (const [label, value] of Object.entries(view.customData ?? {})) {
      if (value) answers.push({ label, value: String(value) });
    }
  }

  return (
    <main className="min-h-screen bg-ink-50 px-4 py-10 dark:bg-ink-950">
      <div className="mx-auto max-w-2xl">
        <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900">
          {/* Branded header */}
          <div className="border-b border-ink-100 px-6 py-5 dark:border-ink-800">
            {view.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.logo} alt="" className="mb-3 max-h-10 max-w-[180px] object-contain" />
            )}
            <h1 className="font-display text-xl font-bold text-ink-900 dark:text-ink-50">
              {view.linkName}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Submitted {dateStr}
              {view.uploaderName && view.mode !== "files_and_answers" ? ` · ${view.uploaderName}` : ""}
              {" · "}
              {view.files.length} {view.files.length === 1 ? "file" : "files"}
            </p>
          </div>

          {/* Answers */}
          {answers.length > 0 && (
            <div className="border-b border-ink-100 px-6 py-4 dark:border-ink-800">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
                Form answers
              </h2>
              <dl className="grid gap-2 sm:grid-cols-2">
                {answers.map((a, i) => (
                  <div key={i} className="text-sm">
                    <dt className="text-ink-400">{a.label}</dt>
                    <dd className="text-ink-800 dark:text-ink-100">{a.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Files */}
          <div className="px-6 py-5">
            {view.files.length === 0 ? (
              <p className="text-sm text-ink-500">No files in this submission.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {view.files.map((f) => {
                  const href = f.externalUrl ?? (f.proxyToken ? `/api/file/${f.proxyToken}` : null);
                  return (
                    <div
                      key={f.id}
                      className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800"
                    >
                      {f.isImage && f.proxyToken ? (
                        <a href={`/api/file/${f.proxyToken}`} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/file/${f.proxyToken}`}
                            alt={f.filename}
                            className="h-40 w-full bg-ink-100 object-cover dark:bg-ink-800"
                          />
                        </a>
                      ) : (
                        <div className="flex h-40 items-center justify-center bg-ink-100 dark:bg-ink-800">
                          {f.externalUrl ? (
                            <Play className="h-10 w-10 text-ink-400" />
                          ) : (
                            <FileIcon className="h-10 w-10 text-ink-400" />
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                            {f.filename}
                          </p>
                          {formatBytes(f.sizeBytes) && (
                            <p className="text-xs text-ink-400">{formatBytes(f.sizeBytes)}</p>
                          )}
                        </div>
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white"
                            style={{ backgroundColor: accent }}
                          >
                            {f.externalUrl ? <Play className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                            {f.externalUrl ? "Watch" : "View"}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Shared securely. Only people with this link can view it.
        </div>
        <p className="mt-6 text-center text-xs text-ink-400">
          Powered by{" "}
          <a
            href="https://nocodeupload.com/?ref=share"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink-500 hover:text-brand hover:underline dark:text-ink-300"
          >
            NoCodeUpload.com
          </a>
        </p>
      </div>
    </main>
  );
}
