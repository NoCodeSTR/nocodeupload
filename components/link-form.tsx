"use client";

/**
 * Create/edit form for an upload link. Used by both
 * /dashboard/links/new and /dashboard/links/[id]/edit.
 *
 * Drives the M5 FolderPicker to choose the destination folder. The selected
 * storage connection determines which Google account the picker opens against;
 * changing the connection clears the picked folder.
 *
 * Submits to:
 *   - POST  /api/links            (create)
 *   - PATCH /api/links/[id]        (edit)
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPicker } from "@/components/folder-picker";
import { CopyButton } from "@/components/copy-button";
import type { ConnectionSummary } from "@/lib/connections";
import type { UploadLinkRow } from "@/lib/db-types";

interface LinkFormProps {
  mode: "create" | "edit";
  connections: ConnectionSummary[];
  pickerConfig: { apiKey: string; projectNumber: string };
  initialLink?: UploadLinkRow;
}

// File-type presets → stored as wildcard mime patterns (M8 enforces at upload).
const TYPE_PRESETS = [
  { key: "images", label: "Images", patterns: ["image/*"] },
  { key: "videos", label: "Videos", patterns: ["video/*"] },
  { key: "pdfs", label: "PDFs", patterns: ["application/pdf"] },
] as const;

const SIZE_OPTIONS = [
  { mb: 100, label: "100 MB" },
  { mb: 512, label: "500 MB" },
  { mb: 1024, label: "1 GB" },
  { mb: 2048, label: "2 GB" },
  { mb: 5120, label: "5 GB" },
  { mb: 10240, label: "10 GB" },
];

function presetsFromMimeList(mimes: string[] | null): Set<string> {
  const set = new Set<string>();
  if (!mimes) return set;
  for (const preset of TYPE_PRESETS) {
    if (preset.patterns.every((p) => mimes.includes(p))) set.add(preset.key);
  }
  return set;
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function LinkForm({ mode, connections, pickerConfig, initialLink }: LinkFormProps) {
  const router = useRouter();

  const [connectionId, setConnectionId] = useState(
    initialLink?.storage_connection_id ?? connections[0]?.id ?? "",
  );
  const [name, setName] = useState(initialLink?.name ?? "");
  const [description, setDescription] = useState(initialLink?.description ?? "");
  const [folder, setFolder] = useState<{ folderId: string; folderName: string } | null>(
    initialLink ? { folderId: initialLink.folder_id, folderName: initialLink.folder_name ?? "Selected folder" } : null,
  );
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(initialLink?.max_file_size_mb ?? 1024);
  const [typePresets, setTypePresets] = useState<Set<string>>(
    presetsFromMimeList(initialLink?.allowed_mime_types ?? null),
  );
  const [requireName, setRequireName] = useState(initialLink?.require_name ?? false);
  const [requireEmail, setRequireEmail] = useState(initialLink?.require_email ?? false);
  const [showMessageField, setShowMessageField] = useState(initialLink?.show_message_field ?? true);
  const [expiresAt, setExpiresAt] = useState(isoToDateInput(initialLink?.expires_at ?? null));
  const [useCustomColor, setUseCustomColor] = useState(Boolean(initialLink?.branding_color));
  const [brandingColor, setBrandingColor] = useState(initialLink?.branding_color ?? "#2563eb");
  const [webhookUrl, setWebhookUrl] = useState(initialLink?.webhook_url ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleType(key: string) {
    setTypePresets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function buildAllowedMimeTypes(): string[] | null {
    if (typePresets.size === 0) return null; // "Any"
    const out: string[] = [];
    for (const preset of TYPE_PRESETS) {
      if (typePresets.has(preset.key)) out.push(...preset.patterns);
    }
    return out;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!connectionId) {
      setError("Pick a connected Google account.");
      return;
    }
    if (!name.trim()) {
      setError("Give your link a name.");
      return;
    }
    if (!folder) {
      setError("Choose a destination folder.");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      storageConnectionId: connectionId,
      folderId: folder.folderId,
      folderName: folder.folderName,
      isActive: initialLink?.is_active ?? true,
      maxFileSizeMb,
      allowedMimeTypes: buildAllowedMimeTypes(),
      requireName,
      requireEmail,
      showMessageField,
      expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      brandingColor: useCustomColor ? brandingColor : null,
      webhookUrl: webhookUrl.trim() || null,
    };

    setSubmitting(true);
    try {
      const url = mode === "create" ? "/api/links" : `/api/links/${initialLink!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(humanizeError(body.error));
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const selectedConnection = connections.find((c) => c.id === connectionId);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Destination */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold">Destination</h2>
          <p className="text-sm text-ink-500">Where uploaded files will land.</p>
        </div>

        {connections.length > 1 && (
          <div>
            <label className="label mb-1" htmlFor="connection">Google account</label>
            <select
              id="connection"
              className="input"
              value={connectionId}
              onChange={(e) => {
                setConnectionId(e.target.value);
                setFolder(null); // folder belongs to the previous account
              }}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider_email ?? c.id}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <span className="label mb-1 block">Folder</span>
          {connectionId ? (
            <FolderPicker
              connectionId={connectionId}
              config={pickerConfig}
              onPick={setFolder}
              initialFolder={folder}
            />
          ) : (
            <p className="text-sm text-ink-500">Select a Google account first.</p>
          )}
          {selectedConnection && (
            <p className="mt-2 text-xs text-ink-400">
              Files upload to this folder in {selectedConnection.provider_email}&apos;s Drive.
            </p>
          )}
        </div>
      </section>

      {/* Details */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold">Details</h2>
          <p className="text-sm text-ink-500">What this link is for.</p>
        </div>
        <div>
          <label className="label mb-1" htmlFor="name">Link name</label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Guest Damage Videos — 123 Beach Rd"
            maxLength={120}
            required
          />
        </div>
        <div>
          <label className="label mb-1" htmlFor="description">
            Internal note <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <textarea
            id="description"
            className="input min-h-[72px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Only you see this. e.g. 'Cleaners use this after each turnover.'"
            maxLength={2000}
          />
        </div>
      </section>

      {/* Upload rules */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold">Upload rules</h2>
          <p className="text-sm text-ink-500">Control what visitors can send.</p>
        </div>

        <div>
          <label className="label mb-1" htmlFor="maxsize">Max file size</label>
          <select
            id="maxsize"
            className="input"
            value={maxFileSizeMb}
            onChange={(e) => setMaxFileSizeMb(Number(e.target.value))}
          >
            {SIZE_OPTIONS.map((o) => (
              <option key={o.mb} value={o.mb}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <span className="label mb-1 block">Allowed file types</span>
          <div className="flex flex-wrap gap-2">
            {TYPE_PRESETS.map((p) => (
              <button
                type="button"
                key={p.key}
                onClick={() => toggleType(p.key)}
                className={
                  typePresets.has(p.key)
                    ? "rounded-lg border border-brand bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
                    : "rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-900"
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-400">
            {typePresets.size === 0
              ? "Any file type allowed."
              : "Only the selected types will be accepted."}
          </p>
        </div>

        <div>
          <label className="label mb-1" htmlFor="expires">
            Expiration date <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="expires"
            type="date"
            className="input"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-400">After this date the link stops accepting uploads.</p>
        </div>
      </section>

      {/* Uploader form fields */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-semibold">Uploader form</h2>
          <p className="text-sm text-ink-500">What you ask visitors for (optional fields).</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={requireName} onChange={(e) => setRequireName(e.target.checked)} />
          Require uploader name
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={requireEmail} onChange={(e) => setRequireEmail(e.target.checked)} />
          Require uploader email
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showMessageField} onChange={(e) => setShowMessageField(e.target.checked)} />
          Show a message / notes field
        </label>
      </section>

      {/* Automations */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold">Automations</h2>
          <p className="text-sm text-ink-500">Send completed uploads to Zapier, Make, or your own webhook.</p>
        </div>
        <div>
          <label className="label mb-1" htmlFor="webhookUrl">
            Webhook URL <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="webhookUrl"
            type="url"
            className="input"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/hooks/catch/..."
            maxLength={2000}
          />
          <p className="mt-1 text-xs text-ink-400">
            NoCodeUpload posts a signed upload.completed payload after each successful file upload.
          </p>
        </div>
        {mode === "edit" && initialLink?.webhook_secret && (
          <div>
            <span className="label mb-1 block">Signing secret</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded bg-ink-100 px-2 py-1 text-xs text-ink-700 dark:bg-ink-900 dark:text-ink-200">
                {initialLink.webhook_secret}
              </code>
              <CopyButton value={initialLink.webhook_secret} label="Copy secret" />
            </div>
            <p className="mt-1 text-xs text-ink-400">
              Verify the X-NoCodeUpload-Signature header with this secret.
            </p>
          </div>
        )}
      </section>

      {/* Branding */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-semibold">Branding</h2>
          <p className="text-sm text-ink-500">Personalize the public upload page.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useCustomColor} onChange={(e) => setUseCustomColor(e.target.checked)} />
          Custom accent color
        </label>
        {useCustomColor && (
          <input
            type="color"
            value={brandingColor}
            onChange={(e) => setBrandingColor(e.target.value)}
            className="h-10 w-20 cursor-pointer rounded border border-ink-200 dark:border-ink-700"
            aria-label="Accent color"
          />
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-ink-200 pt-6 dark:border-ink-700">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : mode === "create" ? "Create upload link" : "Save changes"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => router.push("/dashboard")}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function humanizeError(code?: string): string {
  switch (code) {
    case "connection_not_found":
      return "That Google account connection couldn't be found. Reconnect it in Settings.";
    case "invalid_request":
      return "Some fields are invalid. Double-check the form and try again.";
    case "not_found":
      return "This link no longer exists.";
    default:
      return "Couldn't save the link. Please try again.";
  }
}
