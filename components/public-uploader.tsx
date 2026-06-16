"use client";

/**
 * Public uploader — drag/drop + tap-to-choose, multiple files, per-file
 * progress, mobile-friendly. Uploads each file via the resumable pipeline:
 *
 *   1. POST /api/upload/initiate → { uploadId, sessionUrl, chunkSize }
 *   2. PUT 8 MB chunks DIRECTLY to the Google session URL (XHR for progress;
 *      OAuth token never touches the browser — the session URL is pre-authorized)
 *   3. POST /api/upload/complete → mark done (or failed)
 *
 * Files upload sequentially to keep memory and network sane on phones.
 */
import { useRef, useState, useCallback, useEffect } from "react";
import { Upload, CheckCircle2, XCircle, Loader2, File as FileIcon } from "lucide-react";
import { mimeAllowed, formatBytes, formatSizeMb } from "@/lib/upload-validation";
import { prefillKey } from "@/lib/filename";
import { renderMergeTags } from "@/lib/merge-tags";
import { isFieldVisible } from "@/lib/conditional";
import type { PublicCustomField, PublicUploadBox, FormSection } from "@/lib/db-types";

interface PublicUploaderProps {
  slug: string;
  requireName: boolean;
  requireEmail: boolean;
  showMessageField: boolean;
  maxFileSizeMb: number;
  allowedMimeTypes: string[] | null;
  accent: string;
  hideName?: boolean;
  hideEmail?: boolean;
  prefillName?: string | null;
  prefillEmail?: string | null;
  customFields?: PublicCustomField[];
  successMessage?: string | null;
  successRedirectUrl?: string | null;
  /** Verified password (from the gate) forwarded to initiate; null if none. */
  unlockedPassword?: string | null;
  /** URL query prefills (lowercased keys), used to seed fields. */
  prefill?: Record<string, string>;
  /** Form-only link: collect answers, no file upload (posts to form-submit). */
  formOnly?: boolean;
  /** File link that also permits a zero-file submission (no files this visit). */
  allowEmptySubmission?: boolean;
  /** Multi-box link: one dropzone per box, each routed to its own destination. */
  boxes?: PublicUploadBox[];
  /** Airtable record id from the URL — sent so the server can prefill hidden fields. */
  recordId?: string | null;
  /** Form sections (heading + text) that group the custom fields. */
  sections?: FormSection[];
}

type FileStatus = "queued" | "uploading" | "done" | "failed";

interface FileItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number; // 0–100
  error?: string;
  /** Which upload box this file belongs to (multi-box links). */
  boxId?: string;
}

// ---- Server-relayed resumable upload (browser → our API → Google) ----------

interface ChunkMeta {
  uploadId: string;
  sessionToken: string;
}

/** POST one chunk to our same-origin relay. XHR gives upload progress. */
function postChunk(
  meta: ChunkMeta,
  chunk: Blob,
  start: number,
  end: number,
  total: number,
  onAbsoluteProgress: (loaded: number) => void,
): Promise<{ done: boolean; fileId?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload/chunk", true);
    xhr.setRequestHeader("x-nc-upload-id", meta.uploadId);
    xhr.setRequestHeader("x-nc-session", meta.sessionToken);
    xhr.setRequestHeader("x-nc-range", `bytes ${start}-${end - 1}/${total}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onAbsoluteProgress(start + e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        let body: { status?: string; fileId?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (body.status === "complete") resolve({ done: true, fileId: body.fileId });
        else resolve({ done: false });
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          const b = JSON.parse(xhr.responseText);
          if (b?.detail) msg = `Upload rejected: ${b.detail}`;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(chunk);
  });
}

async function uploadViaRelay(
  meta: ChunkMeta,
  file: File,
  chunkSize: number,
  onProgress: (percent: number) => void,
): Promise<string> {
  const total = file.size;
  let start = 0;

  while (start < total) {
    const end = Math.min(start + chunkSize, total);
    const chunk = file.slice(start, end);

    // Up to 3 attempts per chunk for transient blips.
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await postChunk(meta, chunk, start, end, total, (loaded) =>
          onProgress(Math.min(100, Math.round((loaded / total) * 100))),
        );
        if (result.done) {
          if (!result.fileId) throw new Error("Upload finished without a file id");
          onProgress(100);
          return result.fileId;
        }
        break; // 308-equivalent — chunk accepted, continue
      } catch (err) {
        attempt += 1;
        if (attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    start = end;
  }
  throw new Error("Upload ended unexpectedly");
}

// ---- Component ------------------------------------------------------------

export function PublicUploader({
  slug,
  requireName,
  requireEmail,
  showMessageField,
  maxFileSizeMb,
  allowedMimeTypes,
  accent,
  hideName = false,
  hideEmail = false,
  prefillName = null,
  prefillEmail = null,
  customFields = [],
  successMessage = null,
  successRedirectUrl = null,
  unlockedPassword = null,
  prefill = {},
  formOnly = false,
  allowEmptySubmission = false,
  boxes = [],
  recordId = null,
  sections = [],
}: PublicUploaderProps) {
  const multiBox = boxes.length > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  // Prefill name/email may be dynamic (e.g. {{guest.First Name}}) — resolve tokens
  // against the prefill map (which includes connected-record values). A ?name=
  // URL override still wins.
  const [name, setName] = useState(prefill.name ?? renderMergeTags(prefillName ?? "", prefill));
  const [email, setEmail] = useState(prefill.email ?? renderMergeTags(prefillEmail ?? "", prefill));
  const [message, setMessage] = useState(prefill.message ?? "");
  // Seed each custom field from its URL prefill (by label key), else the owner
  // default — which may itself reference a record source (e.g. {{cleaner.Phone}}),
  // resolved here against the prefill/source values. The uploader can edit it.
  const [customValues, setCustomValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      customFields.map((f) => [f.id, prefill[prefillKey(f.label)] ?? renderMergeTags(f.value ?? "", prefill)]),
    ),
  );
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // For multi-box: which box's dropzone is being dragged over (highlight).
  const [dragBoxId, setDragBoxId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // True once an upload session finishes with at least one success — flips the
  // card over to the success screen (or triggers the owner's redirect).
  const [sessionDone, setSessionDone] = useState(false);

  // Built-in name/email show only when visible (not hidden) and either
  // required or prefilled. Hidden fields are applied server-side.
  const showName = !hideName && (requireName || Boolean(prefillName));
  const showEmail = !hideEmail && (requireEmail || Boolean(prefillEmail));

  const maxBytes = maxFileSizeMb * 1024 * 1024;

  // Only honor http(s) redirects — the value is owner-set, so guard against a
  // javascript:/data: URL ever reaching window.location.
  const redirectUrl =
    successRedirectUrl && /^https?:\/\//i.test(successRedirectUrl) ? successRedirectUrl : null;

  // Warn before leaving while an upload is in progress — the in-flight file
  // would be interrupted (completed files are already safely in Drive).
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  const setItem = useCallback((id: string, patch: Partial<FileItem>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | File[], boxId?: string) => {
      const next: FileItem[] = [];
      for (const file of Array.from(incoming)) {
        let status: FileStatus = "queued";
        let error: string | undefined;
        if (file.size <= 0) {
          status = "failed";
          error = "File is empty.";
        } else if (file.size > maxBytes) {
          status = "failed";
          error = `Too large — max ${formatSizeMb(maxFileSizeMb)}.`;
        } else if (!mimeAllowed(file.type || "application/octet-stream", allowedMimeTypes)) {
          status = "failed";
          error = "This file type isn't allowed here.";
        }
        next.push({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          status,
          progress: 0,
          error,
          boxId,
        });
      }
      setFiles((prev) => [...prev, ...next]);
    },
    [maxBytes, maxFileSizeMb, allowedMimeTypes],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  async function uploadOne(
    item: FileItem,
    batch: { id: string; size: number } | null,
  ): Promise<boolean> {
    setItem(item.id, { status: "uploading", progress: 0, error: undefined });

    // 1. initiate — get an opaque session token + chunk size
    let initiate: { uploadId: string; sessionToken: string; chunkSize: number };
    try {
      const res = await fetch("/api/upload/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          filename: item.file.name,
          size: item.file.size,
          mimeType: item.file.type || "application/octet-stream",
          uploaderName: name.trim() || null,
          uploaderEmail: email.trim() || null,
          uploaderMessage: message.trim() || null,
          customValues,
          // Files uploaded in one click share a batch id (+ declared count) so
          // the owner can get a single bundled notification.
          batchId: batch?.id ?? null,
          batchSize: batch?.size ?? null,
          password: unlockedPassword ?? null,
          // Raw URL prefills so the server can populate hidden fields.
          prefillValues: prefill,
          // Multi-box: which box this file belongs to (server resolves its dest).
          boxId: item.boxId ?? null,
          // Airtable record personalization (server re-fetches authoritatively).
          recordId: recordId ?? null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(humanizeInitiateError(body.error, maxFileSizeMb));
      }
      initiate = await res.json();
    } catch (err) {
      setItem(item.id, { status: "failed", error: err instanceof Error ? err.message : "Couldn't start upload." });
      return false;
    }

    // 2. relay chunks through our API (same-origin). The chunk route finalizes
    //    the upload server-side when Google accepts the last chunk.
    try {
      await uploadViaRelay(
        { uploadId: initiate.uploadId, sessionToken: initiate.sessionToken },
        item.file,
        initiate.chunkSize,
        (percent) => setItem(item.id, { progress: percent }),
      );
    } catch (err) {
      setItem(item.id, { status: "failed", error: err instanceof Error ? err.message : "Upload failed." });
      void fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: initiate.uploadId, errorMessage: "browser upload failed" }),
      }).catch(() => {});
      return false;
    }

    setItem(item.id, { status: "done", progress: 100 });
    return true;
  }

  // Shared field validation (name/email/visible-required customs). Returns an
  // error message or null.
  function validateFields(): string | null {
    if (showName && requireName && !name.trim()) return "Please enter your name.";
    if (showEmail && requireEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return "Please enter a valid email.";
    }
    const missing = customFields.find(
      (f) => f.required && isFieldVisible(f.showWhen, customValues, prefill) && !(customValues[f.id] ?? "").trim(),
    );
    return missing ? `Please fill in "${missing.label}".` : null;
  }

  // Form-only links: no files — POST the answers to /api/upload/form-submit.
  async function handleFormSubmit() {
    setFormError(null);
    const err = validateFields();
    if (err) {
      setFormError(err);
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/upload/form-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          uploaderName: name.trim() || null,
          uploaderEmail: email.trim() || null,
          uploaderMessage: message.trim() || null,
          customValues,
          prefillValues: prefill,
          password: unlockedPassword ?? null,
          recordId: recordId ?? null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(humanizeInitiateError(body.error, maxFileSizeMb));
      }
      setUploading(false);
      setSessionDone(true);
      if (redirectUrl) {
        window.setTimeout(() => {
          window.location.href = redirectUrl;
        }, 900);
      }
    } catch (e) {
      setUploading(false);
      setFormError(e instanceof Error ? e.message : "Couldn't submit the form.");
    }
  }

  async function handleUpload() {
    if (formOnly) return handleFormSubmit();
    setFormError(null);
    if (showName && requireName && !name.trim()) {
      setFormError("Please enter your name.");
      return;
    }
    if (showEmail && requireEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError("Please enter a valid email.");
      return;
    }
    const missingCustom = customFields.find(
      (f) =>
        f.required &&
        isFieldVisible(f.showWhen, customValues, prefill) &&
        !(customValues[f.id] ?? "").trim(),
    );
    if (missingCustom) {
      setFormError(`Please fill in "${missingCustom.label}".`);
      return;
    }
    const queued = files.filter((f) => f.status === "queued");

    // Empty submission: the owner permits sending the form with no files at all,
    // and the visitor added none. Route to the file-less form-submit path (the
    // same one form-only links use). Per-box file requirements don't apply when
    // nothing is being uploaded.
    if (queued.length === 0 && allowEmptySubmission) {
      return handleFormSubmit();
    }

    if (multiBox) {
      for (const box of boxes) {
        if (box.required && !files.some((f) => f.boxId === box.id && f.status === "queued")) {
          setFormError(`Add at least one file to "${box.label}".`);
          return;
        }
      }
    }
    if (queued.length === 0) {
      setFormError("Add at least one file to upload.");
      return;
    }

    setUploading(true);
    // Multiple files in one click form a "batch" — one shared id so the owner
    // can receive a single bundled notification instead of one per file.
    const batch =
      queued.length > 1 ? { id: crypto.randomUUID(), size: queued.length } : null;

    // Sequential — re-read latest items by id as we go.
    let anySuccess = false;
    for (const q of queued) {
      const ok = await uploadOne(q, batch);
      if (ok) anySuccess = true;
    }
    setUploading(false);

    // Tell the server the batch is done so it can send the bundled notification
    // (covers files whose initiate failed; deduped server-side). Fire-and-forget.
    if (batch && anySuccess) {
      void fetch("/api/upload/batch-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id }),
      }).catch(() => {});
    }

    if (anySuccess) {
      setSessionDone(true);
      // If the owner set a redirect, hand off after a short beat so the
      // success registers visually first.
      if (redirectUrl) {
        window.setTimeout(() => {
          window.location.href = redirectUrl;
        }, 900);
      }
    }
  }

  // "Upload more" — clear the file list but keep the uploader's identity so a
  // second batch doesn't require re-typing name/email/custom fields.
  function resetForMore() {
    setFiles([]);
    setSessionDone(false);
    setFormError(null);
  }

  const queuedCount = files.filter((f) => f.status === "queued").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const failedCount = files.filter((f) => f.status === "failed").length;

  // Success state — replaces the form once a session finishes successfully.
  if (sessionDone) {
    // Owner opted to send uploaders to their own page: show a brief hand-off.
    if (redirectUrl) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: accent }} />
          <p className="font-medium text-ink-700 dark:text-ink-200">
            Upload complete — taking you onward…
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: `${accent}1a` }}
        >
          <CheckCircle2 className="h-8 w-8" style={{ color: accent }} />
        </div>
        <div>
          <h2 className="font-display text-xl font-bold">
            {formOnly
              ? "Response received"
              : `${doneCount} ${doneCount === 1 ? "file" : "files"} uploaded`}
          </h2>
          <p className="mt-1 text-ink-500">
            {successMessage?.trim() ||
              (formOnly
                ? "Thank you! Your response was received."
                : "Thank you! Your upload was received.")}
          </p>
        </div>
        {!formOnly && failedCount > 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-300">
            {failedCount} {failedCount === 1 ? "file" : "files"} didn&apos;t go through.
          </p>
        )}
        <button
          type="button"
          onClick={resetForMore}
          className="btn w-full text-white"
          style={{ backgroundColor: accent }}
        >
          {formOnly ? "Submit another response" : "Upload more files"}
        </button>
        <p className="text-xs text-ink-400">
          Powered by{" "}
          <a
            href="https://nocodeupload.com/?ref=success"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink-500 hover:text-brand hover:underline dark:text-ink-300"
          >
            NoCodeUpload.com
          </a>
        </p>
      </div>
    );
  }

  // Render one custom field (used both ungrouped and inside sections).
  function renderField(f: PublicCustomField) {
    const type = f.type ?? "text";
    const cur = customValues[f.id] ?? "";
    const setVal = (v: string) => setCustomValues((prev) => ({ ...prev, [f.id]: v }));

    if (type === "checkbox") {
      return (
        <div key={f.id}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cur === "Yes"}
              disabled={uploading}
              onChange={(e) => setVal(e.target.checked ? "Yes" : "")}
            />
            {f.label} {f.required && <span className="text-red-500">*</span>}
          </label>
        </div>
      );
    }

    return (
      <div key={f.id}>
        <label className="label mb-1" htmlFor={`cf-${f.id}`}>
          {f.label} {f.required && <span className="text-red-500">*</span>}
        </label>

        {type === "select" ? (
          <select
            id={`cf-${f.id}`}
            className="input"
            value={cur}
            disabled={uploading}
            onChange={(e) => setVal(e.target.value)}
          >
            <option value="">Select…</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : type === "multiselect" ? (
          <div className="flex flex-wrap gap-2">
            {(f.options ?? []).map((o) => {
              const selected = cur
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const checked = selected.includes(o);
              return (
                <label
                  key={o}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    checked
                      ? "border-current bg-ink-50 dark:bg-ink-900"
                      : "border-ink-200 text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-900"
                  }`}
                  style={checked ? { color: accent } : undefined}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    disabled={uploading}
                    onChange={(e) => {
                      const set = new Set(selected);
                      if (e.target.checked) set.add(o);
                      else set.delete(o);
                      setVal(Array.from(set).join(", "));
                    }}
                  />
                  {o}
                </label>
              );
            })}
          </div>
        ) : type === "currency" ? (
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
              $
            </span>
            <input
              id={`cf-${f.id}`}
              className="input pl-7"
              inputMode="decimal"
              value={cur}
              onChange={(e) => setVal(e.target.value)}
              disabled={uploading}
              placeholder="0.00"
            />
          </div>
        ) : type === "longtext" ? (
          <textarea
            id={`cf-${f.id}`}
            className="input min-h-[110px]"
            rows={4}
            value={cur}
            onChange={(e) => setVal(e.target.value)}
            disabled={uploading}
          />
        ) : (
          <input
            id={`cf-${f.id}`}
            className="input"
            type={type === "email" ? "email" : type === "phone" ? "tel" : "text"}
            inputMode={type === "number" ? "decimal" : undefined}
            value={cur}
            onChange={(e) => setVal(e.target.value)}
            disabled={uploading}
            placeholder={
              type === "email"
                ? "name@example.com"
                : type === "phone"
                  ? "(555) 555-5555"
                  : type === "number"
                    ? "0"
                    : undefined
            }
          />
        )}
      </div>
    );
  }

  // Render one upload box (multi-box links): reference image, label, dropzone.
  function renderBox(box: PublicUploadBox) {
    const boxFiles = files.filter((f) => f.boxId === box.id);
    const over = dragBoxId === box.id;
    return (
      <div key={box.id}>
        <p className="mb-1 text-sm font-medium text-ink-800 dark:text-ink-100">
          {box.label}
          {box.required && <span className="text-red-500"> *</span>}
        </p>
        {box.instructions && <p className="mb-2 text-sm text-ink-500">{box.instructions}</p>}
        {box.referenceImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={box.referenceImageUrl}
            alt=""
            className="mb-2 max-h-44 w-full rounded-lg border border-ink-200 object-contain dark:border-ink-700"
          />
        )}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragBoxId(box.id);
          }}
          onDragLeave={() => setDragBoxId(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragBoxId(null);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files, box.id);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            over ? "border-current bg-ink-50 dark:bg-ink-900" : "border-ink-300 dark:border-ink-700"
          }`}
          style={over ? { color: accent } : undefined}
        >
          <Upload className="mb-2 h-6 w-6" style={{ color: accent }} />
          <span className="text-sm font-medium text-ink-700 dark:text-ink-200">
            Drag &amp; drop or tap to choose
          </span>
          <input
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files, box.id);
              e.target.value = "";
            }}
          />
        </label>
        {boxFiles.length > 0 && (
          <ul className="mt-2 space-y-2">
            {boxFiles.map((f) => (
              <FileRow key={f.id} item={f} accent={accent} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showName && (
        <div>
          <label className="label mb-1" htmlFor="uploader-name">
            Your name {requireName && <span className="text-red-500">*</span>}
          </label>
          <input id="uploader-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" disabled={uploading} />
        </div>
      )}
      {showEmail && (
        <div>
          <label className="label mb-1" htmlFor="uploader-email">
            Your email {requireEmail && <span className="text-red-500">*</span>}
          </label>
          <input id="uploader-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" disabled={uploading} />
        </div>
      )}
      {showMessageField && (
        <div>
          <label className="label mb-1" htmlFor="uploader-message">
            Message <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <textarea id="uploader-message" className="input min-h-[72px]" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything we should know?" disabled={uploading} />
        </div>
      )}

      {/* Owner-defined fields, respecting conditional visibility + sections.
          Ungrouped fields first, then each non-empty section (heading + text). */}
      {(() => {
        const visibleFields = customFields.filter((f) => isFieldVisible(f.showWhen, customValues, prefill));
        const sectionIds = new Set(sections.map((s) => s.id));
        const showBoxes = !formOnly;
        const ungroupedFields = visibleFields.filter((f) => !f.sectionId || !sectionIds.has(f.sectionId));
        const ungroupedBoxes = showBoxes
          ? boxes.filter((b) => !b.sectionId || !sectionIds.has(b.sectionId))
          : [];
        return (
          <>
            {ungroupedFields.map((f) => renderField(f))}
            {ungroupedBoxes.map((b) => renderBox(b))}
            {sections.map((s) => {
              const secBoxes = showBoxes ? boxes.filter((b) => b.sectionId === s.id) : [];
              const secFields = visibleFields.filter((f) => f.sectionId === s.id);
              if (secBoxes.length === 0 && secFields.length === 0) return null;
              // Merge tags ({{name}}, {{cleaner.Phone}}, …) resolve against the
              // prefill map, which now includes pulled record-source values.
              const heading = renderMergeTags(s.heading?.trim() ?? "", prefill);
              const text = renderMergeTags(s.text?.trim() ?? "", prefill);
              return (
                <div key={s.id} className="space-y-4">
                  {(heading || text) && (
                    <div className="border-t border-ink-200 pt-4 dark:border-ink-700">
                      {heading && <h3 className="font-display text-base font-semibold">{heading}</h3>}
                      {text && <p className="mt-0.5 text-sm text-ink-500">{text}</p>}
                    </div>
                  )}
                  {secBoxes.map((b) => renderBox(b))}
                  {secFields.map((f) => renderField(f))}
                </div>
              );
            })}
          </>
        );
      })()}

      {/* (Multi-box dropzones render inline above, within their sections.) */}

      {/* Single drop zone (non-multi, non-form) */}
      {!formOnly && !multiBox && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragOver ? "border-current bg-ink-50 dark:bg-ink-900" : "border-ink-300 dark:border-ink-700"
          }`}
          style={dragOver ? { color: accent } : undefined}
        >
          <Upload className="mb-3 h-8 w-8" style={{ color: accent }} />
          <p className="font-medium text-ink-700 dark:text-ink-200">Drag &amp; drop files here</p>
          <p className="mt-1 text-sm text-ink-400">or tap to choose — up to {formatSizeMb(maxFileSizeMb)} per file</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
          />
        </div>
      )}

      {/* File list (single mode) */}
      {!multiBox && files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => (
            <FileRow key={f.id} item={f} accent={accent} />
          ))}
        </ul>
      )}

      {formError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
          {formError}
        </div>
      )}

      <button
        type="button"
        onClick={handleUpload}
        disabled={
          formOnly
            ? uploading
            : uploading || (queuedCount === 0 && !allowEmptySubmission)
        }
        className="btn w-full text-white"
        style={{ backgroundColor: accent }}
      >
        {formOnly
          ? uploading
            ? "Submitting…"
            : "Submit"
          : uploading
            ? queuedCount > 0
              ? "Uploading…"
              : "Submitting…"
            : queuedCount > 0
              ? `Upload ${queuedCount} ${queuedCount === 1 ? "file" : "files"}`
              : allowEmptySubmission
                ? "Submit without files"
                : "Add files to upload"}
      </button>
    </div>
  );
}

function FileRow({ item, accent }: { item: FileItem; accent: string }) {
  return (
    <li className="rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-700">
      <div className="flex items-center gap-3">
        <StatusIcon status={item.status} accent={accent} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.file.name}</p>
          <p className="text-xs text-ink-400">{formatBytes(item.file.size)}</p>
        </div>
        <span className="text-xs text-ink-400">
          {item.status === "uploading"
            ? `${item.progress}%`
            : item.status === "done"
              ? "Done"
              : item.status === "failed"
                ? "Failed"
                : "Ready"}
        </span>
      </div>
      {item.status === "uploading" && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
          <div className="h-full rounded-full transition-all" style={{ width: `${item.progress}%`, backgroundColor: accent }} />
        </div>
      )}
      {item.status === "failed" && item.error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-300">{item.error}</p>
      )}
    </li>
  );
}

function StatusIcon({ status, accent }: { status: FileStatus; accent: string }) {
  if (status === "done") return <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" />;
  if (status === "failed") return <XCircle className="h-5 w-5 flex-shrink-0 text-red-500" />;
  if (status === "uploading") return <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" style={{ color: accent }} />;
  return <FileIcon className="h-5 w-5 flex-shrink-0 text-ink-400" />;
}

function humanizeInitiateError(code: string | undefined, maxMb: number): string {
  switch (code) {
    case "not_found": return "This upload link no longer exists.";
    case "inactive": return "This upload link has been turned off.";
    case "expired": return "This upload link has expired.";
    case "too_large": return `That file is too large (max ${formatSizeMb(maxMb)}).`;
    case "type_not_allowed": return "That file type isn't allowed here.";
    case "invalid_password": return "Incorrect password. Check with whoever shared this link.";
    case "missing_name": return "Please enter your name.";
    case "missing_email": return "Please enter a valid email.";
    case "provider_unavailable": return "The destination isn't reachable right now. The owner may need to reconnect their storage.";
    case "rate_limited": return "Too many uploads in a short time. Please wait a few minutes and try again.";
    default: return "Couldn't start the upload. Please try again.";
  }
}
