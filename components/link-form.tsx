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
import { renderFilename, renderText } from "@/lib/filename";
import type { ConnectionSummary } from "@/lib/connections";
import type { UploadLinkRow, CustomFieldDef } from "@/lib/db-types";

// Sentinel folder id for YouTube links. YouTube has no folders — videos land on
// the connected channel — but upload_links.folder_id is NOT NULL and the upload
// pipeline passes it through to the (folder-ignoring) YouTube adapter, so we
// store a harmless placeholder.
const YOUTUBE_FOLDER_SENTINEL = "youtube";

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
  const [prefillName, setPrefillName] = useState(initialLink?.prefill_name ?? "");
  const [prefillEmail, setPrefillEmail] = useState(initialLink?.prefill_email ?? "");
  const [hideName, setHideName] = useState(initialLink?.hide_name ?? false);
  const [hideEmail, setHideEmail] = useState(initialLink?.hide_email ?? false);
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>(
    initialLink?.custom_fields ?? [],
  );
  const [expiresAt, setExpiresAt] = useState(isoToDateInput(initialLink?.expires_at ?? null));
  const [useCustomColor, setUseCustomColor] = useState(Boolean(initialLink?.branding_color));
  const [brandingColor, setBrandingColor] = useState(initialLink?.branding_color ?? "#2563eb");
  const [webhookUrl, setWebhookUrl] = useState(initialLink?.webhook_url ?? "");
  const [filenameTemplate, setFilenameTemplate] = useState(initialLink?.filename_template ?? "");
  const [descriptionTemplate, setDescriptionTemplate] = useState(
    initialLink?.description_template ?? "",
  );
  const [notifyEmail, setNotifyEmail] = useState(initialLink?.notify_email ?? true);
  const [bundleNotifications, setBundleNotifications] = useState(
    initialLink?.bundle_notifications ?? true,
  );
  const [successMessage, setSuccessMessage] = useState(initialLink?.success_message ?? "");
  const [successRedirectUrl, setSuccessRedirectUrl] = useState(
    initialLink?.success_redirect_url ?? "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedConnection = connections.find((c) => c.id === connectionId);
  // YouTube links behave differently: no folder, video-only, and the
  // filename/description templates drive the video's title + description.
  const isYouTube = selectedConnection?.provider === "youtube";

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

  function addCustomField() {
    if (customFields.length >= 3) return;
    setCustomFields((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: "", value: "", visible: true, required: false, type: "text" },
    ]);
  }
  function updateCustomField(id: string, patch: Partial<CustomFieldDef>) {
    setCustomFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function removeCustomField(id: string) {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
  }
  // Switch a field's type, seeding a couple of empty options when becoming a
  // choice field so the options editor isn't blank.
  function setCustomFieldType(id: string, type: CustomFieldDef["type"]) {
    setCustomFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const needsOptions = type === "select" || type === "multiselect";
        const options = needsOptions && (!f.options || f.options.length === 0) ? ["", ""] : f.options;
        return { ...f, type, options };
      }),
    );
  }
  function updateOption(id: string, idx: number, val: string) {
    setCustomFields((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, options: (f.options ?? []).map((o, i) => (i === idx ? val : o)) } : f,
      ),
    );
  }
  function addOption(id: string) {
    setCustomFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, options: [...(f.options ?? []), ""] } : f)),
    );
  }
  function removeOption(id: string, idx: number) {
    setCustomFields((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, options: (f.options ?? []).filter((_, i) => i !== idx) } : f,
      ),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!connectionId) {
      setError("Pick a connected account.");
      return;
    }
    if (!name.trim()) {
      setError("Give your link a name.");
      return;
    }
    // YouTube has no folder — videos go to the channel — so we substitute a
    // sentinel. Drive/other providers still require an explicitly picked folder.
    const effectiveFolder = isYouTube
      ? { folderId: YOUTUBE_FOLDER_SENTINEL, folderName: "YouTube channel (unlisted)" }
      : folder;
    if (!effectiveFolder) {
      setError("Choose a destination folder.");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      storageConnectionId: connectionId,
      folderId: effectiveFolder.folderId,
      folderName: effectiveFolder.folderName,
      isActive: initialLink?.is_active ?? true,
      maxFileSizeMb,
      // YouTube only accepts video, regardless of the type toggles.
      allowedMimeTypes: isYouTube ? ["video/*"] : buildAllowedMimeTypes(),
      requireName,
      requireEmail,
      showMessageField,
      prefillName: prefillName.trim() || null,
      prefillEmail: prefillEmail.trim() || null,
      hideName,
      hideEmail,
      customFields: customFields
        .filter((f) => f.label.trim())
        .map((f) => {
          const type = f.type ?? "text";
          const options =
            type === "text"
              ? undefined
              : (f.options ?? []).map((o) => o.trim()).filter(Boolean);
          return { ...f, label: f.label.trim(), value: f.value.trim(), type, options };
        }),
      expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      brandingColor: useCustomColor ? brandingColor : null,
      webhookUrl: webhookUrl.trim() || null,
      filenameTemplate: filenameTemplate.trim() || null,
      // Only meaningful for YouTube (video description). Null elsewhere.
      descriptionTemplate: isYouTube ? descriptionTemplate.trim() || null : null,
      notifyEmail,
      bundleNotifications,
      successMessage: successMessage.trim() || null,
      successRedirectUrl: successRedirectUrl.trim() || null,
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
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(humanizeError(body.error, body.reason));
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  // Representative sample values for live template previews.
  const previewCtx = {
    originalFilename: isYouTube ? "VID_2024.mp4" : "IMG_2024.jpg",
    uploaderName: prefillName || "jane",
    uploaderEmail: prefillEmail || "jane@example.com",
    uploaderMessage: "Water damage under the kitchen sink",
    customData: Object.fromEntries(
      customFields
        .filter((f) => f.label.trim())
        .map((f) => [f.label.trim(), f.value.trim() || "sample"]),
    ),
    date: new Date(),
  };
  // Drive renames files (slugified, ext preserved); YouTube uses the template
  // as a human-readable video title (raw values, no slug). Both share the same
  // token vocabulary.
  const filenamePreview = renderFilename(filenameTemplate, previewCtx);
  const titlePreview = renderText(filenameTemplate, previewCtx) || previewCtx.originalFilename;
  const descriptionPreview = renderText(descriptionTemplate, previewCtx);

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
            <label className="label mb-1" htmlFor="connection">Connected account</label>
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
                  {providerLabel(c.provider)} — {c.provider_email ?? c.id}
                </option>
              ))}
            </select>
          </div>
        )}

        {isYouTube ? (
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm dark:border-ink-700 dark:bg-ink-900/40">
            <p className="font-medium text-ink-800 dark:text-ink-100">
              Videos upload to your YouTube channel
            </p>
            <p className="mt-1 text-ink-500">
              Each upload is published as <strong>unlisted</strong> — viewable only by people
              with the link. There&apos;s no folder to pick; YouTube organizes videos on the
              channel itself.
            </p>
          </div>
        ) : (
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
              <p className="text-sm text-ink-500">Select a connected account first.</p>
            )}
            {selectedConnection && (
              <p className="mt-2 text-xs text-ink-400">
                Files upload to this folder in {selectedConnection.provider_email}&apos;s Drive.
              </p>
            )}
          </div>
        )}
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

        {isYouTube ? (
          <div>
            <span className="label mb-1 block">Allowed file types</span>
            <span className="inline-flex items-center rounded-lg border border-brand bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100">
              Videos only
            </span>
            <p className="mt-1.5 text-xs text-ink-400">
              YouTube only accepts video files. Non-video uploads are rejected automatically.
            </p>
          </div>
        ) : (
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
        )}

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

        {/* Prefill + hide for name/email */}
        <div className="grid gap-3 border-t border-ink-200 pt-3 dark:border-ink-700 sm:grid-cols-2">
          <div>
            <label className="label mb-1" htmlFor="prefill-name">Prefill name (optional)</label>
            <input id="prefill-name" className="input" value={prefillName} onChange={(e) => setPrefillName(e.target.value)} placeholder="e.g. Maria" />
            <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={hideName} onChange={(e) => setHideName(e.target.checked)} />
              Hide from uploader (attach silently)
            </label>
          </div>
          <div>
            <label className="label mb-1" htmlFor="prefill-email">Prefill email (optional)</label>
            <input id="prefill-email" className="input" value={prefillEmail} onChange={(e) => setPrefillEmail(e.target.value)} placeholder="e.g. maria@example.com" />
            <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={hideEmail} onChange={(e) => setHideEmail(e.target.checked)} />
              Hide from uploader (attach silently)
            </label>
          </div>
        </div>
      </section>

      {/* Custom fields */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-semibold">
            Custom fields <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100">Pro</span>
          </h2>
          <p className="text-sm text-ink-500">
            Up to 3 of your own fields. Hidden + prefilled values get attached to every
            upload and flow into your webhook — perfect for tagging a cleaner&apos;s
            Airtable record ID, phone, etc.
          </p>
        </div>

        {customFields.map((f) => (
          <div key={f.id} className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="input"
                value={f.label}
                onChange={(e) => updateCustomField(f.id, { label: e.target.value })}
                placeholder="Field name (e.g. Cleaner Record ID)"
                maxLength={60}
              />
              <select
                className="input"
                value={f.type ?? "text"}
                onChange={(e) => setCustomFieldType(f.id, e.target.value as CustomFieldDef["type"])}
                aria-label="Field type"
              >
                <option value="text">Text field</option>
                <option value="select">Single-select</option>
                <option value="multiselect">Multi-select</option>
              </select>
            </div>

            {(f.type ?? "text") === "text" ? (
              <input
                className="input mt-2"
                value={f.value}
                onChange={(e) => updateCustomField(f.id, { value: e.target.value })}
                placeholder="Default / prefilled value"
                maxLength={500}
              />
            ) : (
              <div className="mt-2 space-y-2 rounded-md bg-ink-50 p-2 dark:bg-ink-900/40">
                <span className="label">Options</span>
                {(f.options ?? []).map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      className="input"
                      value={opt}
                      onChange={(e) => updateOption(f.id, idx, e.target.value)}
                      placeholder={`Option ${idx + 1} (e.g. Maintenance needed)`}
                      maxLength={80}
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(f.id, idx)}
                      className="px-2 text-lg leading-none text-ink-400 hover:text-red-600"
                      aria-label="Remove option"
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(f.id)}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  + Add option
                </button>
                <input
                  className="input"
                  value={f.value}
                  onChange={(e) => updateCustomField(f.id, { value: e.target.value })}
                  placeholder={
                    f.type === "multiselect"
                      ? "Default selected — comma-separated (optional)"
                      : "Default selected (optional)"
                  }
                  maxLength={500}
                />
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={f.visible}
                  onChange={(e) => updateCustomField(f.id, { visible: e.target.checked })}
                />
                Visible to uploader
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={f.required}
                  disabled={!f.visible}
                  onChange={(e) => updateCustomField(f.id, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                onClick={() => removeCustomField(f.id)}
                className="ml-auto text-red-600 hover:underline dark:text-red-300"
              >
                Remove
              </button>
            </div>
            {!f.visible && (
              <p className="mt-1.5 text-xs text-ink-400">
                Hidden — the prefilled value is attached to every upload without the uploader seeing it.
              </p>
            )}
          </div>
        ))}

        {customFields.length < 3 && (
          <button type="button" onClick={addCustomField} className="btn-secondary text-sm">
            + Add custom field
          </button>
        )}
      </section>

      {/* File naming / Video title */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-semibold">
            {isYouTube ? "Video title" : "File naming"}{" "}
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100">Pro</span>
          </h2>
          <p className="text-sm text-ink-500">
            {isYouTube
              ? "Build each video's title from a template. Leave blank to use the uploaded file's name."
              : "Auto-rename uploaded files using a template. Leave blank to keep the original filenames. Great for searchable, organized uploads."}
          </p>
        </div>
        <input
          className="input font-mono text-sm"
          value={filenameTemplate}
          onChange={(e) => setFilenameTemplate(e.target.value)}
          placeholder={isYouTube ? "{name} — {field:Property}" : "{name}-{date}-{time}"}
          maxLength={200}
        />
        <div className="flex flex-wrap gap-1.5">
          {["{name}", "{date}", "{time}", "{datetime}", "{original}"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilenameTemplate((v) => (v ? `${v}-${t}` : t))}
              className="rounded-md border border-ink-200 px-2 py-1 font-mono text-xs text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-900"
            >
              {t}
            </button>
          ))}
          {customFields
            .filter((f) => f.label.trim())
            .map((f) => {
              const tok = `{field:${f.label.trim()}}`;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilenameTemplate((v) => (v ? `${v}-${tok}` : tok))}
                  className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 font-mono text-xs text-brand-700 hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-900/40 dark:text-brand-100"
                >
                  {tok}
                </button>
              );
            })}
        </div>
        {isYouTube ? (
          <p className="text-xs text-ink-500">
            Title preview:{" "}
            <code className="rounded bg-ink-100 px-1.5 py-0.5 dark:bg-ink-900">{titlePreview}</code>
          </p>
        ) : (
          filenameTemplate.trim() && (
            <p className="text-xs text-ink-500">
              Preview:{" "}
              <code className="rounded bg-ink-100 px-1.5 py-0.5 dark:bg-ink-900">{filenamePreview}</code>
            </p>
          )
        )}
      </section>

      {/* Video description (YouTube only) */}
      {isYouTube && (
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-base font-semibold">
              Video description{" "}
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100">Pro</span>
            </h2>
            <p className="text-sm text-ink-500">
              Auto-fill the YouTube description from the upload&apos;s details. Use the same
              tokens as the title — including hidden custom fields, the uploader&apos;s message,
              and the date. Leave blank for no description.
            </p>
          </div>
          <textarea
            className="input min-h-[96px] font-mono text-sm"
            value={descriptionTemplate}
            onChange={(e) => setDescriptionTemplate(e.target.value)}
            placeholder={"Uploaded by {name} on {date}\nProperty: {field:Property}\n{message}"}
            maxLength={2000}
          />
          <div className="flex flex-wrap gap-1.5">
            {["{name}", "{email}", "{message}", "{date}", "{time}", "{original}"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDescriptionTemplate((v) => (v ? `${v} ${t}` : t))}
                className="rounded-md border border-ink-200 px-2 py-1 font-mono text-xs text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-900"
              >
                {t}
              </button>
            ))}
            {customFields
              .filter((f) => f.label.trim())
              .map((f) => {
                const tok = `{field:${f.label.trim()}}`;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setDescriptionTemplate((v) => (v ? `${v} ${tok}` : tok))}
                    className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 font-mono text-xs text-brand-700 hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-900/40 dark:text-brand-100"
                  >
                    {tok}
                  </button>
                );
              })}
          </div>
          {descriptionTemplate.trim() && (
            <div className="text-xs text-ink-500">
              <span className="block">Description preview:</span>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-ink-100 px-2 py-1.5 font-sans dark:bg-ink-900">{descriptionPreview}</pre>
            </div>
          )}
        </section>
      )}

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

      {/* Notifications & webhook */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-semibold">Notifications &amp; webhook</h2>
          <p className="text-sm text-ink-500">
            Choose how you hear about new uploads.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.checked)}
          />
          Email me when someone uploads
          <span className="text-xs text-ink-400">(uncheck if you only use the webhook)</span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={bundleNotifications}
            onChange={(e) => setBundleNotifications(e.target.checked)}
          />
          <span>
            Bundle multi-file uploads
            <span className="block text-xs text-ink-400">
              When someone uploads several files at once, send one combined notification &amp;
              webhook instead of one per file. Uncheck to get a separate notification for every
              file.
            </span>
          </span>
        </label>

        <p className="pt-1 text-sm text-ink-500">
          Webhook (optional) — we POST a signed JSON payload on every completed upload.
          Point it at Zapier, Make, or your own endpoint.
        </p>
        <div>
          <label className="label mb-1" htmlFor="webhook">Webhook URL</label>
          <input
            id="webhook"
            type="url"
            className="input"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/hooks/catch/..."
          />
        </div>
        {initialLink?.webhook_secret && (
          <div>
            <span className="label mb-1 block">Signing secret</span>
            <p className="mb-2 text-xs text-ink-400">
              Verify requests by recomputing an HMAC-SHA256 of the raw body and comparing it
              to the <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">X-NoCodeUpload-Signature</code> header.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="truncate rounded bg-ink-100 px-2 py-1 font-mono text-xs dark:bg-ink-900">
                {initialLink.webhook_secret}
              </code>
              <CopyButton value={initialLink.webhook_secret} label="Copy secret" />
            </div>
          </div>
        )}
      </section>

      {/* After upload */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-semibold">After upload</h2>
          <p className="text-sm text-ink-500">
            What the uploader sees once their files finish.
          </p>
        </div>
        <div>
          <label className="label mb-1" htmlFor="success-message">
            Success message <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="success-message"
            className="input"
            value={successMessage}
            onChange={(e) => setSuccessMessage(e.target.value)}
            placeholder="Thanks! Your photos were received."
            maxLength={500}
          />
          <p className="mt-1 text-xs text-ink-400">
            Replaces the default confirmation text on the success screen.
          </p>
        </div>
        <div>
          <label className="label mb-1" htmlFor="success-redirect">
            Redirect URL <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="success-redirect"
            type="url"
            className="input"
            value={successRedirectUrl}
            onChange={(e) => setSuccessRedirectUrl(e.target.value)}
            placeholder="https://your-site.com/thank-you"
          />
          <p className="mt-1 text-xs text-ink-400">
            Send uploaders to your own page after they finish. Leave blank to show our
            built-in success screen (with an &ldquo;Upload more&rdquo; button).
          </p>
        </div>
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

function providerLabel(provider: ConnectionSummary["provider"]): string {
  switch (provider) {
    case "google_drive":
      return "Google Drive";
    case "youtube":
      return "YouTube";
    case "dropbox":
      return "Dropbox";
    case "box":
      return "Box";
    case "onedrive":
      return "OneDrive";
    default:
      return provider;
  }
}

function humanizeError(code?: string, reason?: string): string {
  switch (code) {
    case "connection_not_found":
      return "That Google account connection couldn't be found. Reconnect it in Settings.";
    case "invalid_request":
      return "Some fields are invalid. Double-check the form and try again.";
    case "invalid_webhook":
      return reason ?? "That webhook URL isn't allowed. Use a public https:// URL.";
    case "invalid_redirect":
      return "Use a full http:// or https:// URL for the after-upload redirect.";
    case "not_found":
      return "This link no longer exists.";
    default:
      return "Couldn't save the link. Please try again.";
  }
}
