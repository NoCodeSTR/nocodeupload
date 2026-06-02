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

interface PublicUploaderProps {
  slug: string;
  requireName: boolean;
  requireEmail: boolean;
  showMessageField: boolean;
  maxFileSizeMb: number;
  allowedMimeTypes: string[] | null;
  accent: string;
}

type FileStatus = "queued" | "uploading" | "done" | "failed";

interface FileItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number; // 0–100
  error?: string;
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
}: PublicUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const maxBytes = maxFileSizeMb * 1024 * 1024;

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
    (incoming: FileList | File[]) => {
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

  async function uploadOne(item: FileItem): Promise<void> {
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
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(humanizeInitiateError(body.error, maxFileSizeMb));
      }
      initiate = await res.json();
    } catch (err) {
      setItem(item.id, { status: "failed", error: err instanceof Error ? err.message : "Couldn't start upload." });
      return;
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
      return;
    }

    setItem(item.id, { status: "done", progress: 100 });
  }

  async function handleUpload() {
    setFormError(null);
    if (requireName && !name.trim()) {
      setFormError("Please enter your name.");
      return;
    }
    if (requireEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError("Please enter a valid email.");
      return;
    }
    const queued = files.filter((f) => f.status === "queued");
    if (queued.length === 0) {
      setFormError("Add at least one file to upload.");
      return;
    }

    setUploading(true);
    // Sequential — re-read latest items by id as we go.
    for (const q of queued) {
      await uploadOne(q);
    }
    setUploading(false);
  }

  const queuedCount = files.filter((f) => f.status === "queued").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const anyActive = files.some((f) => f.status === "queued" || f.status === "uploading");

  return (
    <div className="space-y-4">
      {requireName && (
        <div>
          <label className="label mb-1" htmlFor="uploader-name">
            Your name <span className="text-red-500">*</span>
          </label>
          <input id="uploader-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" disabled={uploading} />
        </div>
      )}
      {requireEmail && (
        <div>
          <label className="label mb-1" htmlFor="uploader-email">
            Your email <span className="text-red-500">*</span>
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

      {/* Drop zone */}
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

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-700">
              <div className="flex items-center gap-3">
                <StatusIcon status={f.status} accent={accent} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.file.name}</p>
                  <p className="text-xs text-ink-400">{formatBytes(f.file.size)}</p>
                </div>
                <span className="text-xs text-ink-400">
                  {f.status === "uploading" ? `${f.progress}%` : f.status === "done" ? "Done" : f.status === "failed" ? "Failed" : "Ready"}
                </span>
              </div>
              {f.status === "uploading" && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                  <div className="h-full rounded-full transition-all" style={{ width: `${f.progress}%`, backgroundColor: accent }} />
                </div>
              )}
              {f.status === "failed" && f.error && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-300">{f.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {formError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
          {formError}
        </div>
      )}

      {doneCount > 0 && !anyActive && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-900/30 dark:text-green-100">
          {doneCount} {doneCount === 1 ? "file" : "files"} uploaded successfully. Thank you!
        </div>
      )}

      <button
        type="button"
        onClick={handleUpload}
        disabled={uploading || queuedCount === 0}
        className="btn w-full text-white"
        style={{ backgroundColor: accent }}
      >
        {uploading ? "Uploading…" : queuedCount > 0 ? `Upload ${queuedCount} ${queuedCount === 1 ? "file" : "files"}` : "Add files to upload"}
      </button>
    </div>
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
    case "missing_name": return "Please enter your name.";
    case "missing_email": return "Please enter a valid email.";
    case "provider_unavailable": return "The destination isn't reachable right now. The owner may need to reconnect their storage.";
    default: return "Couldn't start the upload. Please try again.";
  }
}
