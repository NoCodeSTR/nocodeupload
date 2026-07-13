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
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown } from "lucide-react";
import { FolderPicker } from "@/components/folder-picker";
import { CopyButton } from "@/components/copy-button";
import { CollapsibleSection } from "@/components/collapsible-section";
import { ConnectedDataEditor } from "@/components/connected-data-editor";
import { AirtableMappingEditor } from "@/components/airtable-mapping-editor";
import { PreviewRecordPicker } from "@/components/preview-record-picker";
import { TokenFieldPicker } from "@/components/token-field-picker";
import { useAirtableSchema } from "@/components/airtable-schema";
import { AirtableImport, type ImportedAirtableField } from "@/components/airtable-import";
import { ImageUploader } from "@/components/image-uploader";
import { renderFilename, renderText, prefillKey } from "@/lib/filename";
import { renderMergeTags } from "@/lib/merge-tags";
import { getFieldMappings } from "@/lib/airtable/sources";
import { uploadLinkCreateSchema } from "@/lib/schemas";
import { LinkLogoField } from "@/components/link-logo-field";
import type { ConnectionSummary } from "@/lib/connections";
import type { ProjectSummary } from "@/lib/projects";
import type { TagSummary } from "@/lib/tags";
import type { DestinationSummary } from "@/components/destinations-manager";
import type {
  UploadLinkRow,
  CustomFieldDef,
  NotificationRule,
  RuleCondition,
  DynamicRecipient,
  AirtableConfig,
  FieldConditionOp,
  UploadBox,
  ContentBlock,
  FormSection,
} from "@/lib/db-types";

// Airtable-style operators offered per controlling field type.
type OpChoice = { op: FieldConditionOp; label: string };
function operatorsForType(type: CustomFieldDef["type"]): OpChoice[] {
  if (type === "checkbox") {
    return [
      { op: "is_filled", label: "is checked" },
      { op: "is_empty", label: "is unchecked" },
    ];
  }
  if (type === "select" || type === "multiselect") {
    return [
      { op: "has_any_of", label: "is any of" },
      { op: "has_none_of", label: "is none of" },
      { op: "equals", label: "is exactly" },
      { op: "not_equals", label: "is not" },
      { op: "is_filled", label: "is filled in" },
      { op: "is_empty", label: "is empty" },
    ];
  }
  if (type === "number" || type === "currency") {
    return [
      { op: "equals", label: "is exactly" },
      { op: "not_equals", label: "is not" },
      { op: "greater_than", label: "greater than" },
      { op: "less_than", label: "less than" },
      { op: "is_filled", label: "is filled in" },
      { op: "is_empty", label: "is empty" },
    ];
  }
  // text / email / phone / default
  return [
    { op: "contains", label: "contains" },
    { op: "not_contains", label: "doesn’t contain" },
    { op: "equals", label: "is exactly" },
    { op: "not_equals", label: "is not" },
    { op: "is_filled", label: "is filled in" },
    { op: "is_empty", label: "is empty" },
  ];
}
function defaultOpForType(type: CustomFieldDef["type"]): FieldConditionOp {
  return operatorsForType(type)[0]?.op ?? "is_filled";
}
/** What value editor a given op needs. */
function conditionValueMode(
  op: FieldConditionOp,
  controllerType: CustomFieldDef["type"],
): "none" | "options" | "single-option" | "text" {
  if (op === "is_filled" || op === "is_empty") return "none";
  const optionField = controllerType === "select" || controllerType === "multiselect";
  if (op === "has_any_of" || op === "has_none_of") return "options";
  if ((op === "equals" || op === "not_equals") && optionField) return "single-option";
  return "text";
}

const FILE_TYPE_CHOICES = ["image", "video", "pdf", "audio", "document", "other"];

/** Map an Airtable field type → our condition field type, for operator choice. */
function airtableTypeToFieldType(t: string | undefined): CustomFieldDef["type"] {
  switch (t) {
    case "checkbox":
      return "checkbox";
    case "singleSelect":
      return "select";
    case "multipleSelects":
      return "multiselect";
    case "currency":
      return "currency";
    case "number":
    case "percent":
    case "duration":
    case "rating":
      return "number";
    case "email":
      return "email";
    case "phoneNumber":
      return "phone";
    default:
      return "text";
  }
}

// Sentinel folder id for YouTube links. YouTube has no folders — videos land on
// the connected channel — but upload_links.folder_id is NOT NULL and the upload
// pipeline passes it through to the (folder-ignoring) YouTube adapter, so we
// store a harmless placeholder.
const YOUTUBE_FOLDER_SENTINEL = "youtube";

// --- Validation messaging ----------------------------------------------------
// Map a zod issue (from the shared uploadLinkCreateSchema) to a human, field-
// named message so the owner knows EXACTLY what to fix — not just "some fields
// are invalid". Nested array paths (customFields/uploadBoxes/…) resolve to the
// offending item by its label, and the offending custom-field ids are returned
// so their rows can be highlighted inline.
const LINK_FIELD_LABELS: Record<string, string> = {
  name: "Link name",
  description: "Description",
  successRedirectUrl: "Redirect URL",
  successMessage: "Success message",
  webhookUrl: "Webhook URL",
  brandingColor: "Brand color",
  brandingLogoUrl: "Logo URL",
  expiresAt: "Expiry date",
  prefillEmail: "Prefill email",
  prefillName: "Prefill name",
  filenameTemplate: "Filename template",
  descriptionTemplate: "Video description template",
  maxFileSizeMb: "Max file size",
  uploadPassword: "Upload password",
};

type FormIssue = { path: (string | number)[]; message: string };

function friendlyIssueMessage(message: string): string {
  if (/invalid url/i.test(message)) return "must be a full URL, including https://";
  if (/invalid email/i.test(message)) return "must be a valid email address";
  if (/invalid datetime/i.test(message)) return "isn't a valid date";
  return message;
}

interface DescribedIssues {
  messages: string[];
  fieldIds: Set<string>;
}

function describeLinkIssues(
  issues: FormIssue[],
  payload: {
    customFields?: Array<{ id: string; label: string }>;
    uploadBoxes?: Array<{ label: string }> | null;
  },
): DescribedIssues {
  const messages = new Set<string>();
  const fieldIds = new Set<string>();

  for (const issue of issues) {
    const [head, idx] = issue.path;
    let label: string;

    if (head === "customFields" && typeof idx === "number") {
      const cf = payload.customFields?.[idx];
      if (cf?.id) fieldIds.add(cf.id);
      label = `Custom field “${cf?.label?.trim() || `#${idx + 1}`}”`;
    } else if (head === "uploadBoxes" && typeof idx === "number") {
      const box = payload.uploadBoxes?.[idx];
      label = `Upload box “${box?.label?.trim() || `#${idx + 1}`}”`;
    } else if (head === "sections" && typeof idx === "number") {
      label = `Section #${idx + 1}`;
    } else if (head === "notificationRules" && typeof idx === "number") {
      label = `Notification rule #${idx + 1}`;
    } else if (head === "airtableConfig") {
      label = "Airtable mapping";
    } else if (typeof head === "string") {
      label = LINK_FIELD_LABELS[head] ?? head;
    } else {
      label = "Form";
    }

    messages.add(`${label}: ${friendlyIssueMessage(issue.message)}`);
  }

  return { messages: Array.from(messages), fieldIds };
}

interface LinkFormProps {
  mode: "create" | "edit";
  connections: ConnectionSummary[];
  pickerConfig: { apiKey: string; projectNumber: string };
  initialLink?: UploadLinkRow;
  destinations?: DestinationSummary[];
  projects?: ProjectSummary[];
  allTags?: TagSummary[];
  initialTags?: string[];
  /** Whether the user has connected Airtable (gates the Airtable section). */
  airtableConnected?: boolean;
  /** The account's default logo, shown as the fallback preview for per-link logo. */
  accountLogoUrl?: string | null;
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

export function LinkForm({
  mode,
  connections,
  pickerConfig,
  initialLink,
  destinations = [],
  projects = [],
  allTags = [],
  initialTags = [],
  airtableConnected = false,
  accountLogoUrl = null,
}: LinkFormProps) {
  const router = useRouter();

  const initialDestType = initialLink?.destination_type ?? "drive";
  // Pick a connection that MATCHES the destination. Drive and YouTube can be the
  // same Google account (same email), so connections[0] may be the wrong-scope
  // one — selecting it would make the Drive folder picker request a YouTube
  // token and 403. For a saved link we keep its stored connection.
  const initialConnectionId =
    initialLink?.storage_connection_id ??
    connections.find((c) =>
      initialDestType === "youtube" ? c.provider === "youtube" : c.provider === "google_drive",
    )?.id ??
    connections[0]?.id ??
    "";
  const [connectionId, setConnectionId] = useState(initialConnectionId);
  const [destinationType, setDestinationType] = useState<"drive" | "youtube" | "form" | "multi">(
    initialDestType,
  );
  const [uploadBoxes, setUploadBoxes] = useState<UploadBox[]>(initialLink?.upload_boxes ?? []);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>(initialLink?.content_blocks ?? []);
  const [sections, setSections] = useState<FormSection[]>(initialLink?.sections ?? []);
  const [name, setName] = useState(initialLink?.name ?? "");
  const [hideTitle, setHideTitle] = useState(initialLink?.hide_title ?? false);
  const [description, setDescription] = useState(initialLink?.description ?? "");
  const [projectId, setProjectId] = useState(initialLink?.project_id ?? "");
  const [projectList, setProjectList] = useState<ProjectSummary[]>(projects);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [folder, setFolder] = useState<{ folderId: string; folderName: string } | null>(
    initialLink && initialLink.folder_id
      ? { folderId: initialLink.folder_id, folderName: initialLink.folder_name ?? "Selected folder" }
      : null,
  );
  // Dynamic Drive folders: a new subfolder per submission, optionally inside a
  // per-property folder resolved from a connected record.
  const [subfolderPerSubmission, setSubfolderPerSubmission] = useState(
    initialLink?.subfolder_per_submission ?? false,
  );
  const [subfolderTemplate, setSubfolderTemplate] = useState(initialLink?.subfolder_template ?? "");
  const [propertyFolderAlias, setPropertyFolderAlias] = useState(initialLink?.property_folder_alias ?? "");
  const [propertyFolderIdField, setPropertyFolderIdField] = useState(
    initialLink?.property_folder_id_field ?? "",
  );
  const [propertyFolderTemplate, setPropertyFolderTemplate] = useState(
    initialLink?.property_folder_template ?? "",
  );
  const [multiboxOwnFolders, setMultiboxOwnFolders] = useState(initialLink?.multibox_own_folders ?? false);
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
  const [allowEmptySubmission, setAllowEmptySubmission] = useState(
    initialLink?.allow_empty_submission ?? false,
  );
  const [publicFiles, setPublicFiles] = useState(initialLink?.public_files ?? false);
  const [sharePageMode, setSharePageMode] = useState<"off" | "files" | "files_and_answers">(
    initialLink?.share_page_mode ?? "off",
  );
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>(
    initialLink?.custom_fields ?? [],
  );
  const [expiresAt, setExpiresAt] = useState(isoToDateInput(initialLink?.expires_at ?? null));
  const [useCustomColor, setUseCustomColor] = useState(Boolean(initialLink?.branding_color));
  const [brandingColor, setBrandingColor] = useState(initialLink?.branding_color ?? "#2563eb");
  const [brandingLogoUrl, setBrandingLogoUrl] = useState<string | null>(initialLink?.branding_logo_url ?? null);
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
  const [usePassword, setUsePassword] = useState(Boolean(initialLink?.upload_password));
  const [uploadPassword, setUploadPassword] = useState(initialLink?.upload_password ?? "");
  const [rules, setRules] = useState<NotificationRule[]>(initialLink?.notification_rules ?? []);
  const [airtableConfig, setAirtableConfig] = useState<AirtableConfig | null>(
    initialLink?.airtable_config ?? null,
  );
  // One shared Airtable schema loader for both Connected Data (source) and
  // Airtable Mapping (destination) so bases/tables are fetched once.
  const airtableSchema = useAirtableSchema(airtableConnected, airtableConfig?.baseId);
  // Connected sources usable for merge tags / conditions (have a table + alias).
  const prefillSources = (airtableConfig?.recordSources ?? []).filter(
    (s) => s.tableId && s.alias.trim(),
  );
  // Preview Mode: real connected-record values (keyed `${aliasKey}.${fieldKey}`)
  // chosen via the per-source pickers, plus the picked record's display label.
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewLabels, setPreviewLabels] = useState<Record<string, string>>({});
  function setPreviewForAlias(aliasKey: string, values: Record<string, string>, label: string) {
    setPreviewValues((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (!k.startsWith(`${aliasKey}.`)) next[k] = v;
      return { ...next, ...values };
    });
    setPreviewLabels((prev) => ({ ...prev, [aliasKey]: label }));
  }

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Specific, field-named validation problems (from the shared schema) + the set
  // of custom-field ids to highlight inline. Surfaced together in the banner.
  const [issues, setIssues] = useState<string[]>([]);
  const [invalidFieldIds, setInvalidFieldIds] = useState<Set<string>>(new Set());
  const errorBannerRef = useRef<HTMLDivElement | null>(null);

  const selectedConnection = connections.find((c) => c.id === connectionId);
  // Destination drives behavior: YouTube = no folder, video-only; Form only =
  // no file upload at all (collect answers → submission + Airtable).
  const isYouTube = destinationType === "youtube";
  const isFormOnly = destinationType === "form";
  const isMulti = destinationType === "multi";
  // Connections that fit the chosen destination (Drive vs YouTube).
  const eligibleConnections = connections.filter((c) =>
    destinationType === "youtube" ? c.provider === "youtube" : c.provider === "google_drive",
  );

  // Keep the selected connection valid for the current destination. Guards the
  // initial mount and any path that changes destination without re-selecting.
  useEffect(() => {
    if (destinationType === "drive" || destinationType === "youtube") {
      if (!eligibleConnections.some((c) => c.id === connectionId)) {
        setConnectionId(eligibleConnections[0]?.id ?? "");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationType]);

  // Switch destination; reset the connection to one that fits (and clear folder).
  function changeDestination(next: "drive" | "youtube" | "form" | "multi") {
    setDestinationType(next);
    setFolder(null);
    if (next === "form" || next === "multi") {
      setConnectionId("");
    } else {
      const fit = connections.find((c) =>
        next === "youtube" ? c.provider === "youtube" : c.provider === "google_drive",
      );
      setConnectionId(fit?.id ?? "");
    }
  }

  // --- Upload boxes (multi-box destination) ---------------------------------
  function defaultBoxConnection(): { connectionId: string; destinationType: "drive" | "youtube" } {
    const drive = connections.find((c) => c.provider === "google_drive");
    const pick = drive ?? connections[0];
    return {
      connectionId: pick?.id ?? "",
      destinationType: pick?.provider === "youtube" ? "youtube" : "drive",
    };
  }
  function addBox() {
    if (uploadBoxes.length >= 20) return;
    const d = defaultBoxConnection();
    setUploadBoxes((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: "",
        instructions: "",
        destinationType: d.destinationType,
        connectionId: d.connectionId,
        folderId: null,
        folderName: null,
        referenceImageUrl: null,
        required: false,
      },
    ]);
  }
  function updateBox(id: string, patch: Partial<UploadBox>) {
    setUploadBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function removeBox(id: string) {
    setUploadBoxes((prev) => prev.filter((b) => b.id !== id));
  }
  function moveBox(id: string, dir: "up" | "down") {
    setUploadBoxes((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  // Choosing a connection sets the box's destination type + clears its folder.
  function setBoxConnection(id: string, connectionId: string) {
    const conn = connections.find((c) => c.id === connectionId);
    updateBox(id, {
      connectionId,
      destinationType: conn?.provider === "youtube" ? "youtube" : "drive",
      folderId: null,
      folderName: null,
    });
  }

  // --- Content blocks (heading / text / divider, with merge tags) -----------
  function addContentBlock(type: ContentBlock["type"]) {
    if (contentBlocks.length >= 30) return;
    setContentBlocks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type, text: type === "divider" ? undefined : "" },
    ]);
  }
  function updateContentBlock(id: string, text: string) {
    setContentBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, text } : b)));
  }
  function removeContentBlock(id: string) {
    setContentBlocks((prev) => prev.filter((b) => b.id !== id));
  }
  function moveContentBlock(id: string, dir: "up" | "down") {
    setContentBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function insertContentToken(id: string, token: string) {
    setContentBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, text: (b.text ?? "") + token } : b)),
    );
  }

  // --- Sections (group fields under a heading + text) -----------------------
  function addSection() {
    if (sections.length >= 30) return;
    setSections((prev) => [...prev, { id: crypto.randomUUID(), heading: "", text: "" }]);
  }
  function updateSection(id: string, patch: Partial<FormSection>) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeSection(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id));
    setCustomFields((prev) => prev.map((f) => (f.sectionId === id ? { ...f, sectionId: null } : f)));
  }
  function moveSection(id: string, dir: "up" | "down") {
    setSections((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  // Import fields from an Airtable table: create matching custom fields AND wire
  // the write-back (this link will send answers back to that table's columns).
  function importAirtableFields(result: {
    baseId: string;
    baseName: string;
    tableId: string;
    tableName: string;
    fields: ImportedAirtableField[];
  }) {
    const existing = new Set(customFields.map((f) => f.label.trim().toLowerCase()));
    const added: CustomFieldDef[] = result.fields
      .filter((f) => f.label.trim() && !existing.has(f.label.trim().toLowerCase()))
      .map((f) => ({
        id: crypto.randomUUID(),
        label: f.label.trim(),
        value: "",
        visible: true,
        required: false,
        type: f.type,
        options: f.options,
      }));
    if (added.length) setCustomFields((prev) => [...prev, ...added]);

    setAirtableConfig((prev) => {
      const baseCfg: AirtableConfig = prev ?? {
        enabled: true,
        baseId: "",
        baseName: "",
        tableId: "",
        tableName: "",
        recordMode: "per_upload",
        attachFiles: false,
        attachFieldName: null,
        mapping: {},
        staticValues: [],
      };
      // Switching tables invalidates the old table's field mappings. Auto-map
      // each imported column to its matching custom field (dest field ← the
      // field:<Label> source) so the owner never re-maps imported columns.
      const tableChanged = baseCfg.tableId !== result.tableId;
      const prevMaps = tableChanged ? [] : getFieldMappings(baseCfg);
      const byField = new Map(prevMaps.map((m) => [m.field, m]));
      for (const f of result.fields) {
        const label = f.label.trim();
        byField.set(label, { field: label, source: `field:${label}` });
      }
      return {
        ...baseCfg,
        enabled: true,
        baseId: result.baseId,
        baseName: result.baseName,
        tableId: result.tableId,
        tableName: result.tableName,
        mapping: {},
        fieldMappings: Array.from(byField.values()),
        attachFieldName: tableChanged ? null : baseCfg.attachFieldName,
        staticValues: tableChanged ? [] : baseCfg.staticValues,
      };
    });
  }

  // Sample values for the builder preview. Real connected-record values from
  // Preview Mode (previewValues) override the samples, so {{guest.First Name}}
  // shows the actual picked record's value.
  const mergeSample: Record<string, string> = {
    name: prefillName || "Jane",
    email: prefillEmail || "jane@example.com",
    message: "Sample message",
    ...Object.fromEntries(
      customFields.filter((f) => f.label.trim()).map((f) => [f.label.trim(), f.value.trim() || "sample"]),
    ),
    ...previewValues,
  };

  function addTag(name: string) {
    const n = name.trim();
    setTagInput("");
    if (!n || tags.length >= 20) return;
    if (tags.some((t) => t.toLowerCase() === n.toLowerCase())) return;
    setTags((prev) => [...prev, n]);
  }
  function removeTag(name: string) {
    setTags((prev) => prev.filter((t) => t !== name));
  }

  async function createProjectInline() {
    const projectName = newProjectName.trim();
    if (!projectName) return;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName }),
      });
      if (!res.ok) {
        setError("Couldn't create that project.");
        return;
      }
      const p = (await res.json()) as { id: string; name: string };
      setProjectList((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)));
      setProjectId(p.id);
      setNewProjectName("");
      setCreatingProject(false);
    } catch {
      setError("Couldn't create that project.");
    }
  }

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
    if (customFields.length >= 50) return;
    setCustomFields((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: "", value: "", visible: true, required: false, type: "text" },
    ]);
  }
  function updateCustomField(id: string, patch: Partial<CustomFieldDef>) {
    setCustomFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    // Editing a flagged field clears its highlight so the cue tracks reality.
    setInvalidFieldIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }
  function removeCustomField(id: string) {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
  }
  function moveCustomField(id: string, dir: "up" | "down") {
    setCustomFields((prev) => {
      const i = prev.findIndex((f) => f.id === id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
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

  // --- Conditional visibility (show a field only when another field matches) ---
  // Any other labeled field can be a controller.
  function isController(c: CustomFieldDef, selfId: string): boolean {
    return c.id !== selfId && Boolean(c.label.trim());
  }
  function toggleShowWhen(id: string, on: boolean) {
    setCustomFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        if (!on) return { ...f, showWhen: null };
        const ctrl = prev.find((c) => isController(c, id));
        return {
          ...f,
          showWhen: { fieldId: ctrl?.id ?? "", op: defaultOpForType(ctrl?.type), values: [] },
        };
      }),
    );
  }
  function setShowWhenController(id: string, controllerId: string) {
    setCustomFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const ctrl = prev.find((c) => c.id === controllerId);
        return { ...f, showWhen: { fieldId: controllerId, op: defaultOpForType(ctrl?.type), values: [] } };
      }),
    );
  }
  // Controller = a field on a CONNECTED record (alias + field key). Clears the
  // sibling-field controller; type drives the default operator.
  function setShowWhenSource(
    id: string,
    aliasKey: string,
    fieldKey: string,
    fieldType: CustomFieldDef["type"],
  ) {
    setCustomFields((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, showWhen: { source: aliasKey, fieldId: fieldKey, op: defaultOpForType(fieldType), values: [] } }
          : f,
      ),
    );
  }
  function setShowWhenOp(id: string, op: FieldConditionOp) {
    setCustomFields((prev) =>
      prev.map((f) => (f.id === id && f.showWhen ? { ...f, showWhen: { ...f.showWhen, op, values: [] } } : f)),
    );
  }
  // Single-value ops (text / single-option).
  function setShowWhenValue(id: string, value: string) {
    setCustomFields((prev) =>
      prev.map((f) => (f.id === id && f.showWhen ? { ...f, showWhen: { ...f.showWhen, values: value ? [value] : [] } } : f)),
    );
  }
  // Multi-value ops (has any of / has none of).
  function toggleShowWhenValue(id: string, value: string) {
    setCustomFields((prev) =>
      prev.map((f) => {
        if (f.id !== id || !f.showWhen) return f;
        const has = f.showWhen.values.includes(value);
        return {
          ...f,
          showWhen: {
            ...f.showWhen,
            values: has ? f.showWhen.values.filter((v) => v !== value) : [...f.showWhen.values, value],
          },
        };
      }),
    );
  }

  // --- Routing rules ---------------------------------------------------------
  function addRule() {
    if (rules.length >= 10) return;
    setRules((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: "", matchMode: "all", conditions: [], destinationIds: [], ownerEmail: false },
    ]);
  }
  function updateRule(id: string, patch: Partial<NotificationRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }
  function addCondition(id: string) {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== id || r.conditions.length >= 5) return r;
        const firstField = customFields.find((f) => f.label.trim())?.label.trim() ?? "__fileType";
        const t: CustomFieldDef["type"] =
          firstField === "__fileType"
            ? "select"
            : customFields.find((f) => f.label.trim() === firstField)?.type ?? "text";
        return {
          ...r,
          conditions: [...r.conditions, { field: firstField, op: defaultOpForType(t), values: [] }],
        };
      }),
    );
  }
  function updateCondition(id: string, idx: number, patch: Partial<RuleCondition>) {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, conditions: r.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)) }
          : r,
      ),
    );
  }
  function removeCondition(id: string, idx: number) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, conditions: r.conditions.filter((_, i) => i !== idx) } : r)),
    );
  }
  function insertRuleToken(id: string, token: string) {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, messageTemplate: r.messageTemplate ? `${r.messageTemplate}${token}` : token }
          : r,
      ),
    );
  }
  function toggleRuleDestination(id: string, destId: string) {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const has = r.destinationIds.includes(destId);
        return {
          ...r,
          destinationIds: has ? r.destinationIds.filter((d) => d !== destId) : [...r.destinationIds, destId],
        };
      }),
    );
  }
  // Dynamic recipients — route SMS/email to a value on a connected record.
  function addDynamicRecipient(id: string) {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              dynamicRecipients: [
                ...(r.dynamicRecipients ?? []),
                { id: crypto.randomUUID(), channel: "sms", source: "", field: "", viaDestinationId: null },
              ],
            }
          : r,
      ),
    );
  }
  function updateDynamicRecipient(id: string, drId: string, patch: Partial<DynamicRecipient>) {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              dynamicRecipients: (r.dynamicRecipients ?? []).map((dr) =>
                dr.id === drId ? { ...dr, ...patch } : dr,
              ),
            }
          : r,
      ),
    );
  }
  function removeDynamicRecipient(id: string, drId: string) {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, dynamicRecipients: (r.dynamicRecipients ?? []).filter((dr) => dr.id !== drId) }
          : r,
      ),
    );
  }
  // Value choices for a rule condition: file-type list, a select field's
  // options, or null (free text).
  function ruleValueOptions(field: string): string[] | null {
    if (field === "__fileType") return FILE_TYPE_CHOICES;
    const cf = customFields.find((f) => f.label.trim() === field);
    if (cf && (cf.type === "select" || cf.type === "multiselect")) {
      return (cf.options ?? []).map((o) => o.trim()).filter(Boolean);
    }
    if (cf && cf.type === "checkbox") return ["Yes"];
    return null;
  }

  function flagIssues(messages: string[], fieldIds: Set<string> = new Set()) {
    setError(null);
    setIssues(messages);
    setInvalidFieldIds(fieldIds);
    // Bring the summary into view — the form is long and the banner sits at the
    // bottom, so a failed save otherwise looks like nothing happened.
    requestAnimationFrame(() => {
      errorBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues([]);
    setInvalidFieldIds(new Set());

    if (!name.trim()) {
      flagIssues(["Link name: give your link a name."]);
      return;
    }

    // Resolve the destination. Form-only links need no storage at all.
    let storageConnectionId: string | null = null;
    let folderId: string | null = null;
    let folderName: string | null = null;
    if (destinationType === "youtube") {
      if (!connectionId) {
        setError("Pick a connected YouTube account.");
        return;
      }
      storageConnectionId = connectionId;
      folderId = YOUTUBE_FOLDER_SENTINEL;
      folderName = "YouTube channel (unlisted)";
    } else if (destinationType === "drive") {
      if (!connectionId) {
        setError("Pick a connected Google Drive account.");
        return;
      }
      if (!folder) {
        setError("Choose a destination folder.");
        return;
      }
      storageConnectionId = connectionId;
      folderId = folder.folderId;
      folderName = folder.folderName;
    } else if (destinationType === "multi") {
      const labeled = uploadBoxes.filter((b) => b.label.trim());
      if (labeled.length === 0) {
        setError("Add at least one upload box.");
        return;
      }
      // Model B (shared master): boxes use one master folder, so they don't each
      // need their own folder — but the master must be picked.
      const sharedMaster = subfolderPerSubmission && !multiboxOwnFolders;
      if (sharedMaster) {
        if (!connectionId || !folder) {
          setError("Pick a master folder for the per-submission folders.");
          return;
        }
        storageConnectionId = connectionId;
        folderId = folder.folderId;
        folderName = folder.folderName;
      } else {
        for (const b of labeled) {
          if (!b.connectionId) {
            setError(`Pick a destination account for "${b.label.trim()}".`);
            return;
          }
          if (b.destinationType === "drive" && !b.folderId) {
            setError(`Choose a folder for "${b.label.trim()}".`);
            return;
          }
        }
      }
    }

    const cleanedBoxes: UploadBox[] = uploadBoxes
      .filter((b) => b.label.trim())
      .map((b) => ({
        ...b,
        label: b.label.trim(),
        instructions: b.instructions?.trim() || null,
        folderName: b.folderName ?? null,
        referenceImageUrl: b.referenceImageUrl || null,
        sectionId: b.sectionId && sections.some((s) => s.id === b.sectionId) ? b.sectionId : null,
      }));

    const keptFieldIds = new Set(customFields.filter((f) => f.label.trim()).map((f) => f.id));
    const keptSectionIds = new Set(sections.map((s) => s.id));

    const payload = {
      name: name.trim(),
      hideTitle,
      subfolderPerSubmission:
        destinationType === "drive" || destinationType === "multi" ? subfolderPerSubmission : false,
      subfolderTemplate: subfolderTemplate.trim() || null,
      propertyFolderAlias: propertyFolderAlias || null,
      propertyFolderIdField: propertyFolderIdField || null,
      propertyFolderTemplate: propertyFolderTemplate.trim() || null,
      multiboxOwnFolders: destinationType === "multi" ? multiboxOwnFolders : false,
      description: description.trim() || null,
      destinationType,
      storageConnectionId,
      folderId,
      folderName,
      isActive: initialLink?.is_active ?? true,
      maxFileSizeMb,
      // YouTube only accepts video; form-only has no files (null = any/none).
      allowedMimeTypes: isFormOnly ? null : isYouTube ? ["video/*"] : buildAllowedMimeTypes(),
      uploadBoxes: isMulti ? cleanedBoxes : null,
      contentBlocks: contentBlocks
        .filter((b) => b.type === "divider" || (b.text ?? "").trim())
        .map((b) => ({ ...b, text: b.text?.trim() || undefined })),
      requireName,
      requireEmail,
      showMessageField,
      prefillName: prefillName.trim() || null,
      prefillEmail: prefillEmail.trim() || null,
      hideName,
      hideEmail,
      allowEmptySubmission,
      publicFiles,
      sharePageMode,
      customFields: customFields
        .filter((f) => f.label.trim())
        .map((f) => {
          const type = f.type ?? "text";
          const options =
            type === "select" || type === "multiselect"
              ? (f.options ?? []).map((o) => o.trim()).filter(Boolean)
              : undefined;
          // Keep a conditional rule only if it's on a visible field and points
          // at a still-present controlling field. Value-less operators (is
          // filled / is empty) don't need a value; the rest do.
          let showWhen = f.showWhen ?? null;
          if (showWhen) {
            const op = showWhen.op ?? "has_any_of";
            const needsValue = op !== "is_filled" && op !== "is_empty";
            // A connected-record controller (source set) points at an Airtable
            // field key, not a sibling custom-field id — so skip the kept-field
            // check for it (the source is validated by the airtableConfig).
            const controllerMissing = showWhen.source
              ? !showWhen.fieldId
              : !showWhen.fieldId || !keptFieldIds.has(showWhen.fieldId);
            if (!f.visible || controllerMissing || (needsValue && showWhen.values.length === 0)) {
              showWhen = null;
            }
          }
          let sectionId = f.sectionId ?? null;
          if (sectionId && !keptSectionIds.has(sectionId)) sectionId = null;
          // optionStyle only applies to single-select; drop it elsewhere.
          const optionStyle = type === "select" ? f.optionStyle : undefined;
          return { ...f, label: f.label.trim(), value: f.value.trim(), type, options, optionStyle, showWhen, sectionId };
        }),
      sections: sections.map((s) => ({
        id: s.id,
        heading: s.heading?.trim() || undefined,
        text: s.text?.trim() || undefined,
      })),
      expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      brandingColor: useCustomColor ? brandingColor : null,
      brandingLogoUrl: brandingLogoUrl || null,
      webhookUrl: webhookUrl.trim() || null,
      filenameTemplate: filenameTemplate.trim() || null,
      // Only meaningful for YouTube (video description). Null elsewhere.
      descriptionTemplate: isYouTube ? descriptionTemplate.trim() || null : null,
      notifyEmail,
      bundleNotifications,
      // Keep only rules that actually route somewhere; trim condition values.
      notificationRules: rules
        .filter((r) => r.destinationIds.length > 0 || r.ownerEmail)
        .map((r) => ({
          ...r,
          messageTemplate: r.messageTemplate?.trim() || null,
          conditions: r.conditions
            .filter((c) => {
              if (!c.field) return false;
              const op = c.op ?? "has_any_of";
              const needsValue = op !== "is_filled" && op !== "is_empty";
              const vals = (c.values?.length ? c.values : c.value ? [c.value] : [])
                .map((v) => v.trim())
                .filter(Boolean);
              return !needsValue || vals.length > 0;
            })
            .map((c) => {
              const vals = (c.values?.length ? c.values : c.value ? [c.value] : [])
                .map((v) => v.trim())
                .filter(Boolean);
              return { ...c, values: vals, value: vals[0] ?? "" };
            }),
        })),
      successMessage: successMessage.trim() || null,
      successRedirectUrl: successRedirectUrl.trim() || null,
      uploadPassword: usePassword ? uploadPassword.trim() || null : null,
      projectId: projectId || null,
      tags,
      // Persist the Airtable config when there's a usable base AND either
      // connected tables (data source) or a record destination (enabled + table).
      // Connected Data alone is worth saving (it powers personalization without
      // creating a record). Otherwise null, clearing any prior config on edit.
      airtableConfig: (() => {
        const cfg = airtableConfig;
        if (!airtableConnected || !cfg?.baseId) return null;
        const hasSources = (cfg.recordSources ?? []).some((s) => s.tableId && s.alias.trim());
        const hasDestination = Boolean(cfg.enabled && cfg.tableId);
        return hasSources || hasDestination ? cfg : null;
      })(),
    };

    // Pre-validate against the SAME schema the server enforces, so the owner
    // gets instant, specific feedback (which field, and why) instead of a
    // round-trip that comes back as a generic "some fields are invalid".
    const check = uploadLinkCreateSchema.safeParse(payload);
    if (!check.success) {
      const { messages, fieldIds } = describeLinkIssues(check.error.issues, payload);
      flagIssues(
        messages.length ? messages : ["Some fields need attention — please review the form above."],
        fieldIds,
      );
      return;
    }

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

  // Representative sample values for live template previews.
  const previewCtx = {
    originalFilename: isYouTube ? "VID_2024.mp4" : "IMG_2024.jpg",
    uploaderName: prefillName || "jane",
    uploaderEmail: prefillEmail || "jane@example.com",
    uploaderMessage: "Water damage under the kitchen sink",
    resultUrl: "https://drive.google.com/file/d/EXAMPLE/view",
    submissionUrl: "https://nocodeupload.com/dashboard/submissions/example",
    count: 3,
    customData: Object.fromEntries(
      customFields
        .filter((f) => f.label.trim())
        .map((f) => [f.label.trim(), f.value.trim() || "sample"]),
    ),
    date: new Date(),
  };
  // Two-pass: resolve connected-record {{alias.Field}} merge tags first (against
  // the sample/preview values), THEN the filename tokens ({date}, {field:Label}…).
  // Mirrors the runtime in /api/upload/initiate so the preview matches reality.
  const filenameTemplateResolved = renderMergeTags(filenameTemplate, mergeSample);
  const descriptionTemplateResolved = renderMergeTags(descriptionTemplate, mergeSample);
  const filenamePreview = renderFilename(filenameTemplateResolved, previewCtx);
  const titlePreview = renderText(filenameTemplateResolved, previewCtx) || previewCtx.originalFilename;
  const descriptionPreview = renderText(descriptionTemplateResolved, previewCtx);

  // Tag suggestions: the user's existing tags not already selected, filtered by
  // what they're typing.
  const selectedTagsLower = new Set(tags.map((t) => t.toLowerCase()));
  const tagQuery = tagInput.trim().toLowerCase();
  const tagSuggestions = allTags
    .map((t) => t.name)
    .filter((n) => !selectedTagsLower.has(n.toLowerCase()) && (!tagQuery || n.toLowerCase().includes(tagQuery)))
    .slice(0, 8);

  // Shared "new folder per submission" config, used by single-Drive and
  // multi-box. Plain function returning JSX (NOT a component) so inputs keep
  // focus across re-renders.
  function renderSubfolderConfig(forMulti: boolean) {
    const driveConns = connections.filter((c) => c.provider === "google_drive");
    const modelC = forMulti && multiboxOwnFolders;
    const showProperty = !modelC && prefillSources.length > 0;
    const propSrc = prefillSources.find((s) => prefillKey(s.alias) === propertyFolderAlias);
    return (
      <div className="mt-4 space-y-3 border-t border-ink-100 pt-4 dark:border-ink-800">
        <label className="flex items-start gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={subfolderPerSubmission}
            onChange={(e) => setSubfolderPerSubmission(e.target.checked)}
          />
          <span>
            Create a new folder for each submission
            <span className="block text-xs font-normal text-ink-400">
              {forMulti
                ? "Each submission gets its own folder; your boxes become subfolders inside it (Kitchen, Living Room, …)."
                : "The folder above becomes the “master”; every submission gets its own subfolder inside it, so each clean’s photos stay together."}
            </span>
          </span>
        </label>

        {subfolderPerSubmission && (
          <div className="space-y-3 pl-6">
            {forMulti && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={multiboxOwnFolders}
                  onChange={(e) => setMultiboxOwnFolders(e.target.checked)}
                />
                <span>
                  Let each box upload to its own Drive folder
                  <span className="block text-xs font-normal text-ink-400">
                    Off (recommended): all boxes share one master folder and become subfolders inside
                    each submission’s folder. On: each box keeps its own folder (set on the box), with
                    a new per-submission subfolder inside it.
                  </span>
                </span>
              </label>
            )}

            <div>
              <label className="label mb-1" htmlFor="subfolder-tpl">Folder name for each submission</label>
              <input
                id="subfolder-tpl"
                className="input"
                value={subfolderTemplate}
                onChange={(e) => setSubfolderTemplate(e.target.value)}
                placeholder="{date} {name}"
                maxLength={200}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-400">
                  Tokens: {"{date}"}, {"{name}"}, {"{field:Label}"}. Connected field:
                </span>
                {prefillSources.map((s) => (
                  <TokenFieldPicker
                    key={s.id}
                    aliasKey={prefillKey(s.alias)}
                    fields={(airtableSchema.tables.find((t) => t.id === s.tableId)?.fields ?? []).map((f) => f.name)}
                    onInsert={(tok) => setSubfolderTemplate((v) => (v ? `${v} ${tok}` : tok))}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-400">Blank uses date + uploader name.</p>
            </div>

            {/* Multi Model B needs a single master folder (single-Drive uses the folder above). */}
            {forMulti && !multiboxOwnFolders && (
              <div>
                <span className="label mb-1 block">
                  Master folder <span className="font-normal text-ink-400">(all boxes upload here)</span>
                </span>
                <select
                  className="input mb-2"
                  value={connectionId ?? ""}
                  onChange={(e) => setConnectionId(e.target.value)}
                >
                  <option value="">Choose a Google Drive account…</option>
                  {driveConns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.provider_email ?? c.id}
                    </option>
                  ))}
                </select>
                {connectionId ? (
                  <FolderPicker
                    connectionId={connectionId}
                    config={pickerConfig}
                    onPick={setFolder}
                    initialFolder={folder}
                  />
                ) : (
                  <p className="text-sm text-ink-500">Pick a Drive account to choose the master folder.</p>
                )}
              </div>
            )}

            {showProperty && (
              <div className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                <span className="label block">
                  Nest inside a per-property folder{" "}
                  <span className="font-normal text-ink-400">(optional)</span>
                </span>
                <p className="text-xs text-ink-400">
                  Put each submission’s folder inside a folder for its property. NoCodeUpload creates
                  the property folder under the master on first use and stores its ID in Airtable, so
                  one form runs hundreds of properties.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink-500">Property record</span>
                  <select
                    className="input w-auto py-1 text-xs"
                    value={propertyFolderAlias}
                    onChange={(e) => {
                      setPropertyFolderAlias(e.target.value);
                      setPropertyFolderIdField("");
                    }}
                  >
                    <option value="">— off —</option>
                    {prefillSources.map((s) => (
                      <option key={s.id} value={prefillKey(s.alias)}>
                        {s.alias.trim()}
                      </option>
                    ))}
                  </select>
                </div>
                {propertyFolderAlias && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-ink-500">Drive folder ID field</span>
                      <select
                        className="input w-auto py-1 text-xs"
                        value={propertyFolderIdField}
                        onChange={(e) => setPropertyFolderIdField(e.target.value)}
                      >
                        <option value="">Choose field…</option>
                        {(airtableSchema.tables.find((t) => t.id === propSrc?.tableId)?.fields ?? []).map((f) => (
                          <option key={f.id} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label mb-1" htmlFor="prop-folder-tpl">Property folder name</label>
                      <input
                        id="prop-folder-tpl"
                        className="input"
                        value={propertyFolderTemplate}
                        onChange={(e) => setPropertyFolderTemplate(e.target.value)}
                        placeholder={`{{${prefillKey(propSrc?.alias ?? "property")}.Name}}`}
                        maxLength={200}
                      />
                      <p className="mt-1 text-xs text-ink-400">
                        Used only when a property folder doesn’t exist yet. Pick the field that stores
                        each property’s Drive folder ID — it starts empty and fills in automatically
                        after the first submission.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Destination */}
      <CollapsibleSection title="Destination" description="Where each submission goes." defaultOpen>

        <div>
          <span className="label mb-1 block">Destination</span>
          <div className="flex flex-wrap gap-2">
            {([
              { key: "drive", label: "Google Drive" },
              { key: "youtube", label: "YouTube" },
              { key: "multi", label: "Multiple upload boxes" },
              { key: "form", label: "Form only (no files)" },
            ] as const).map((opt) => (
              <button
                type="button"
                key={opt.key}
                onClick={() => changeDestination(opt.key)}
                className={
                  destinationType === opt.key
                    ? "rounded-lg border border-brand bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
                    : "rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-900"
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          {isFormOnly && (
            <p className="mt-1.5 text-xs text-ink-400">
              Collect form answers with no file upload — straight to a submission (and Airtable /
              notifications if set up). No storage account required.
            </p>
          )}
          {isMulti && (
            <p className="mt-1.5 text-xs text-ink-400">
              Several upload boxes in one form — each box sends to its own destination (a Drive
              folder or YouTube). Great for “kitchen photos here, walkthrough video there.”
            </p>
          )}
        </div>

        {/* Connection picker (single Drive / YouTube only) */}
        {!isFormOnly && !isMulti &&
          (eligibleConnections.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
              No {isYouTube ? "YouTube" : "Google Drive"} account connected.{" "}
              <a
                href={isYouTube ? "/api/google/connect?target=youtube" : "/api/google/connect"}
                className="font-medium underline"
              >
                Connect one
              </a>{" "}
              or pick <strong>Form only</strong>.
            </div>
          ) : eligibleConnections.length > 1 ? (
            <div>
              <label className="label mb-1" htmlFor="connection">Connected account</label>
              <select
                id="connection"
                className="input"
                value={connectionId}
                onChange={(e) => {
                  setConnectionId(e.target.value);
                  setFolder(null);
                }}
              >
                {eligibleConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {providerLabel(c.provider)} — {c.provider_email ?? c.id}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <span className="label mb-1 block">Connected account</span>
              <p className="text-sm text-ink-600 dark:text-ink-300">
                {providerLabel(eligibleConnections[0].provider)} —{" "}
                {eligibleConnections[0].provider_email ?? "your account"}
              </p>
            </div>
          ))}

        {isFormOnly ? (
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm dark:border-ink-700 dark:bg-ink-900/40">
            <p className="font-medium text-ink-800 dark:text-ink-100">Form only — no file upload</p>
            <p className="mt-1 text-ink-500">
              Add the fields you want to collect below. Route them to Airtable and notifications in
              their sections.
            </p>
          </div>
        ) : isMulti ? (
          <div className="space-y-3">
            {connections.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
                Connect a Google Drive or YouTube account first, then add boxes.
              </div>
            ) : (
              <>
                {renderSubfolderConfig(true)}
                {subfolderPerSubmission && !multiboxOwnFolders && (
                  <p className="text-xs text-ink-400">
                    Each box below becomes a subfolder (named by its label) inside every submission’s
                    folder — so you only set the box labels here, not per-box destinations.
                  </p>
                )}
                {uploadBoxes.map((b, idx) => {
                  const conn = connections.find((c) => c.id === b.connectionId);
                  return (
                    <div key={b.id} className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-ink-500">Box {idx + 1}</span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveBox(b.id, "up")}
                            disabled={idx === 0}
                            className="rounded p-1 text-ink-400 enabled:hover:bg-ink-100 disabled:opacity-30 dark:enabled:hover:bg-ink-800"
                            aria-label="Move box up"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveBox(b.id, "down")}
                            disabled={idx === uploadBoxes.length - 1}
                            className="rounded p-1 text-ink-400 enabled:hover:bg-ink-100 disabled:opacity-30 dark:enabled:hover:bg-ink-800"
                            aria-label="Move box down"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeBox(b.id)}
                            className="ml-1 text-xs text-red-600 hover:underline dark:text-red-300"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <input
                        className="input"
                        value={b.label}
                        onChange={(e) => updateBox(b.id, { label: e.target.value })}
                        placeholder="Box label (e.g. Kitchen photos)"
                        maxLength={80}
                      />
                      <input
                        className="input"
                        value={b.instructions ?? ""}
                        onChange={(e) => updateBox(b.id, { instructions: e.target.value })}
                        placeholder="Instructions (optional) — e.g. Get the whole counter in frame"
                        maxLength={500}
                      />
                      {/* Per-box destination — hidden in Model B (all boxes share the master). */}
                      {!(subfolderPerSubmission && !multiboxOwnFolders) && (
                        <>
                          <div>
                            <label className="label mb-1 block">Destination</label>
                            <select
                              className="input"
                              value={b.connectionId}
                              onChange={(e) => setBoxConnection(b.id, e.target.value)}
                            >
                              {connections.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {providerLabel(c.provider)} — {c.provider_email ?? c.id}
                                </option>
                              ))}
                            </select>
                          </div>
                          {b.destinationType === "youtube" ? (
                            <p className="text-xs text-ink-500">
                              Videos in this box upload to {conn?.provider_email ?? "your channel"} as
                              unlisted YouTube videos.
                            </p>
                          ) : (
                            <FolderPicker
                              key={b.id}
                              connectionId={b.connectionId}
                              config={pickerConfig}
                              onPick={(f) => updateBox(b.id, { folderId: f.folderId, folderName: f.folderName })}
                              initialFolder={
                                b.folderId ? { folderId: b.folderId, folderName: b.folderName ?? "Selected folder" } : null
                              }
                            />
                          )}
                        </>
                      )}
                      <ImageUploader
                        value={b.referenceImageUrl}
                        onChange={(url) => updateBox(b.id, { referenceImageUrl: url })}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(b.required)}
                          onChange={(e) => updateBox(b.id, { required: e.target.checked })}
                        />
                        Require at least one file in this box
                      </label>
                      {sections.length > 0 && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-ink-500">Section</span>
                          <select
                            className="input w-auto py-1 text-xs"
                            value={b.sectionId ?? ""}
                            onChange={(e) => updateBox(b.id, { sectionId: e.target.value || null })}
                          >
                            <option value="">No section</option>
                            {sections.map((s, i) => (
                              <option key={s.id} value={s.id}>
                                {s.heading?.trim() || `Section ${i + 1}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
                {uploadBoxes.length < 20 && (
                  <button type="button" onClick={addBox} className="btn-secondary text-sm">
                    + Add upload box
                  </button>
                )}
                <p className="text-xs text-ink-400">
                  Each box collects files into its own destination. All boxes are submitted together
                  as one submission.
                </p>
              </>
            )}
          </div>
        ) : isYouTube ? (
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
              <p className="text-sm text-ink-500">Connect a Google Drive account first.</p>
            )}
            {selectedConnection && (
              <p className="mt-2 text-xs text-ink-400">
                Files upload to this folder in {selectedConnection.provider_email}&apos;s Drive.
              </p>
            )}

            {/* Dynamic folders — a new subfolder per submission (Master = the folder above) */}
            <div className="mt-4 space-y-3 border-t border-ink-100 pt-4 dark:border-ink-800">
              <label className="flex items-start gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={subfolderPerSubmission}
                  onChange={(e) => setSubfolderPerSubmission(e.target.checked)}
                />
                <span>
                  Create a new folder for each submission
                  <span className="block text-xs font-normal text-ink-400">
                    The folder above becomes the “master”; every submission gets its own subfolder
                    inside it, so each clean’s photos stay together.
                  </span>
                </span>
              </label>

              {subfolderPerSubmission && (
                <div className="space-y-3 pl-6">
                  <div>
                    <label className="label mb-1" htmlFor="subfolder-tpl">Folder name for each submission</label>
                    <input
                      id="subfolder-tpl"
                      className="input"
                      value={subfolderTemplate}
                      onChange={(e) => setSubfolderTemplate(e.target.value)}
                      placeholder="{date} {name}"
                      maxLength={200}
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-ink-400">
                        Tokens: {"{date}"}, {"{name}"}, {"{field:Label}"}. Connected field:
                      </span>
                      {prefillSources.map((s) => (
                        <TokenFieldPicker
                          key={s.id}
                          aliasKey={prefillKey(s.alias)}
                          fields={(airtableSchema.tables.find((t) => t.id === s.tableId)?.fields ?? []).map((f) => f.name)}
                          onInsert={(tok) => setSubfolderTemplate((v) => (v ? `${v} ${tok}` : tok))}
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-ink-400">
                      Blank uses date + uploader name.
                    </p>
                  </div>

                  {/* Phase 2 — per-property folders (needs a connected data source) */}
                  {prefillSources.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                      <span className="label block">
                        Nest inside a per-property folder{" "}
                        <span className="font-normal text-ink-400">(optional)</span>
                      </span>
                      <p className="text-xs text-ink-400">
                        Put each submission’s folder inside a folder for its property. NoCodeUpload
                        creates the property folder under the master on first use and stores its ID
                        in Airtable, so one form runs hundreds of properties.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-ink-500">Property record</span>
                        <select
                          className="input w-auto py-1 text-xs"
                          value={propertyFolderAlias}
                          onChange={(e) => {
                            setPropertyFolderAlias(e.target.value);
                            setPropertyFolderIdField("");
                          }}
                        >
                          <option value="">— off —</option>
                          {prefillSources.map((s) => (
                            <option key={s.id} value={prefillKey(s.alias)}>
                              {s.alias.trim()}
                            </option>
                          ))}
                        </select>
                      </div>
                      {propertyFolderAlias && (
                        <>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-ink-500">Drive folder ID field</span>
                            <select
                              className="input w-auto py-1 text-xs"
                              value={propertyFolderIdField}
                              onChange={(e) => setPropertyFolderIdField(e.target.value)}
                            >
                              <option value="">Choose field…</option>
                              {(() => {
                                const src = prefillSources.find((s) => prefillKey(s.alias) === propertyFolderAlias);
                                const flds = airtableSchema.tables.find((t) => t.id === src?.tableId)?.fields ?? [];
                                return flds.map((f) => (
                                  <option key={f.id} value={f.name}>
                                    {f.name}
                                  </option>
                                ));
                              })()}
                            </select>
                          </div>
                          <div>
                            <label className="label mb-1" htmlFor="prop-folder-tpl">Property folder name</label>
                            <input
                              id="prop-folder-tpl"
                              className="input"
                              value={propertyFolderTemplate}
                              onChange={(e) => setPropertyFolderTemplate(e.target.value)}
                              placeholder={`{{${prefillKey(prefillSources.find((s) => prefillKey(s.alias) === propertyFolderAlias)?.alias ?? "property")}.Name}}`}
                              maxLength={200}
                            />
                            <p className="mt-1 text-xs text-ink-400">
                              Used only when a property folder doesn’t exist yet. Pick the field that
                              stores each property’s Drive folder ID — it starts empty and fills in
                              automatically after the first submission.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </CollapsibleSection>

      {/* Connected data — Airtable connection + base + connected tables (source) */}
      <CollapsibleSection
        title="Connected data"
        badge="Pro"
        description="Connect Airtable tables whose records this form can reference everywhere — merge tags, file naming, mapping, routing, and notifications."
      >
        <ConnectedDataEditor
          connected={airtableConnected}
          value={airtableConfig}
          onChange={setAirtableConfig}
          schema={airtableSchema}
        />
      </CollapsibleSection>

      {/* Preview — pick a real record per connected table and watch the form
          personalize. Only shown once a base + connected tables exist. */}
      {airtableConfig?.baseId &&
        (airtableConfig.recordSources ?? []).some((s) => s.tableId && s.alias.trim()) && (
          <CollapsibleSection
            title="Preview"
            badge="Pro"
            description="Pick a real record from each connected table to see exactly what the uploader will experience — headings, file names, and prefills with real data."
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {(airtableConfig.recordSources ?? [])
                  .filter((s) => s.tableId && s.alias.trim())
                  .map((s) => {
                    const t = airtableSchema.tables.find((tt) => tt.id === s.tableId);
                    return (
                      <PreviewRecordPicker
                        key={s.id}
                        baseId={airtableConfig.baseId}
                        tableId={s.tableId}
                        primaryField={t?.fields?.[0]?.name ?? ""}
                        aliasKey={prefillKey(s.alias)}
                        sourceLabel={s.alias.trim() || s.tableName || "Record"}
                        onPick={setPreviewForAlias}
                      />
                    );
                  })}
              </div>

              {Object.values(previewLabels).some(Boolean) && (
                <p className="text-xs text-ink-500">
                  Previewing with:{" "}
                  {Object.entries(previewLabels)
                    .filter(([, l]) => l)
                    .map(([a, l]) => `${a} = ${l}`)
                    .join("  ·  ")}
                </p>
              )}

              {/* Compact "what the uploader sees" header preview. */}
              <div className="rounded-lg border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-950">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
                  Uploader sees
                </p>
                <h3 className="font-display text-lg font-bold">{name.trim() || "Your upload link"}</h3>
                {description.trim() && <p className="mt-1 text-sm text-ink-500">{description.trim()}</p>}
                {contentBlocks
                  .filter((b) => b.type === "divider" || (b.text ?? "").trim())
                  .map((b) => {
                    if (b.type === "divider") {
                      return <hr key={b.id} className="my-3 border-ink-200 dark:border-ink-700" />;
                    }
                    const text = renderMergeTags(b.text ?? "", mergeSample);
                    if (!text.trim()) return null;
                    return b.type === "heading" ? (
                      <h4 key={b.id} className="mt-3 font-display text-base font-semibold">
                        {text}
                      </h4>
                    ) : (
                      <p key={b.id} className="mt-2 whitespace-pre-wrap text-sm text-ink-600 dark:text-ink-300">
                        {text}
                      </p>
                    );
                  })}
                {(() => {
                  const pn = !hideName ? renderMergeTags(prefillName, mergeSample).trim() : "";
                  const pe = !hideEmail ? renderMergeTags(prefillEmail, mergeSample).trim() : "";
                  if (!pn && !pe) return null;
                  return (
                    <div className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
                      {pn && (
                        <p>
                          <span className="text-ink-400">Name prefilled:</span> {pn}
                        </p>
                      )}
                      {pe && (
                        <p>
                          <span className="text-ink-400">Email prefilled:</span> {pe}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
              <p className="text-xs text-ink-400">
                File-naming and other previews below also update to use the picked record. Pick{" "}
                <span className="font-medium">Leave blank</span> on a record to clear it.
              </p>
            </div>
          </CollapsibleSection>
        )}

      {/* Details */}
      <CollapsibleSection title="Details" description="What this link is for." defaultOpen>
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
          <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-500">
            <input type="checkbox" checked={hideTitle} onChange={(e) => setHideTitle(e.target.checked)} />
            Hide this title on the public form (it still shows in your dashboard)
          </label>
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
          <p className="mt-1 text-xs text-ink-400">
            Private — never shown on the public form. To add intro text uploaders see, use a
            heading or text block in “Form intro &amp; content”.
          </p>
        </div>
        <div>
          <label className="label mb-1" htmlFor="project">
            Project <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <select
            id="project"
            className="input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">No project</option>
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {creatingProject ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="input flex-1"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="New project name"
                maxLength={80}
              />
              <button type="button" onClick={createProjectInline} className="btn-primary h-9 text-sm">
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingProject(false);
                  setNewProjectName("");
                }}
                className="btn-ghost h-9 text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingProject(true)}
              className="mt-1.5 text-xs font-medium text-brand hover:underline"
            >
              + New project
            </button>
          )}
        </div>

        <div>
          <label className="label mb-1">
            Tags <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ink-200 p-2 dark:border-ink-700">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  className="leading-none hover:text-red-600"
                  aria-label={`Remove ${t}`}
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                } else if (e.key === "Backspace" && !tagInput && tags.length) {
                  removeTag(tags[tags.length - 1]);
                }
              }}
              placeholder={tags.length ? "Add another…" : "Add tags (e.g. Cleaners, Property A)"}
            />
          </div>
          {tagSuggestions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tagSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addTag(s)}
                  className="rounded-md border border-ink-200 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-900"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-ink-400">
            Reusable labels for sorting &amp; search. Pick an existing one or type a new one
            (Enter to add).
          </p>
        </div>

        {/* Branding (logo + accent color) — part of the link's presentation */}
        <div className="mt-4 space-y-4 border-t border-ink-100 pt-4 dark:border-ink-800">
          <LinkLogoField value={brandingLogoUrl} onChange={setBrandingLogoUrl} fallbackUrl={accountLogoUrl} />
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useCustomColor} onChange={(e) => setUseCustomColor(e.target.checked)} />
              Custom accent color
            </label>
            {useCustomColor && (
              <input
                type="color"
                value={brandingColor}
                onChange={(e) => setBrandingColor(e.target.value)}
                className="mt-2 h-10 w-20 cursor-pointer rounded border border-ink-200 dark:border-ink-700"
                aria-label="Accent color"
              />
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Upload rules */}
      <CollapsibleSection
        title={isFormOnly ? "Form rules" : "Upload rules"}
        description={isFormOnly ? "Control access to this form." : "Control what visitors can send."}
        defaultOpen
      >

        {!isFormOnly && (
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
        )}

        {!isFormOnly && (
          <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={allowEmptySubmission}
                onChange={(e) => setAllowEmptySubmission(e.target.checked)}
              />
              Allow submitting the form without files
            </label>
            <p className="mt-1.5 text-xs text-ink-400">
              Lets a visitor send their answers even when they have nothing to upload (e.g. a
              cleaner with no photos this visit). Required upload boxes are still enforced.
            </p>
          </div>
        )}

        {!isFormOnly && !isYouTube && (
          <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={publicFiles}
                onChange={(e) => setPublicFiles(e.target.checked)}
              />
              Let anyone with the link view uploaded files
            </label>
            <p className="mt-1.5 text-xs text-ink-400">
              Files land private in your Drive by default, so the file links in your notifications
              only open for people with Drive access. Turn this on to grant each uploaded file
              “anyone with the link can view” — so links sent by email, Slack, or text work for
              outside recipients (like a cleaner). Leave off to keep files private.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          <label className="label mb-1" htmlFor="share-page">Public share page</label>
          <select
            id="share-page"
            className="input"
            value={sharePageMode}
            onChange={(e) => setSharePageMode(e.target.value as "off" | "files" | "files_and_answers")}
          >
            <option value="off">Off — no public page</option>
            <option value="files">Files only</option>
            <option value="files_and_answers">Files + form answers</option>
          </select>
          <p className="mt-1.5 text-xs text-ink-400">
            Gives each submission a clean, branded page you can forward to anyone — no login. Files
            stream through a secure link, so your Drive stays private either way. “Files + answers”
            also shows what the submitter filled in.
          </p>
        </div>

        {isFormOnly ? null : isYouTube ? (
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

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
            Require a password to upload
          </label>
          {usePassword && (
            <input
              className="input mt-2"
              value={uploadPassword}
              onChange={(e) => setUploadPassword(e.target.value)}
              placeholder="e.g. 1234 — share it with your uploaders"
              maxLength={100}
            />
          )}
          <p className="mt-1 text-xs text-ink-400">
            Off by default. When on, uploaders must enter this exact value first. Keep it as
            simple as you like (a 4-digit code works).
          </p>
        </div>
      </CollapsibleSection>

      {/* Form intro & content blocks */}
      <CollapsibleSection
        title="Form intro & content"
        badge="Pro"
        description="Headings, text, and dividers shown at the top of your public form. Use {{merge tags}} to personalize from the link's URL — e.g. Hey {{first_name}}!"
      >
        {contentBlocks.map((b, idx) => (
          <div key={b.id} className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-400">{b.type}</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveContentBlock(b.id, "up")}
                  disabled={idx === 0}
                  className="rounded p-1 text-ink-400 enabled:hover:bg-ink-100 disabled:opacity-30 dark:enabled:hover:bg-ink-800"
                  aria-label="Move up"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveContentBlock(b.id, "down")}
                  disabled={idx === contentBlocks.length - 1}
                  className="rounded p-1 text-ink-400 enabled:hover:bg-ink-100 disabled:opacity-30 dark:enabled:hover:bg-ink-800"
                  aria-label="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeContentBlock(b.id)}
                  className="ml-1 text-xs text-red-600 hover:underline dark:text-red-300"
                >
                  Remove
                </button>
              </div>
            </div>
            {b.type === "divider" ? (
              <hr className="border-ink-200 dark:border-ink-700" />
            ) : (
              <>
                {b.type === "heading" ? (
                  <input
                    className="input font-medium"
                    value={b.text ?? ""}
                    onChange={(e) => updateContentBlock(b.id, e.target.value)}
                    placeholder="Heading — e.g. Welcome, {{first_name}}!"
                    maxLength={200}
                  />
                ) : (
                  <textarea
                    className="input min-h-[72px]"
                    value={b.text ?? ""}
                    onChange={(e) => updateContentBlock(b.id, e.target.value)}
                    placeholder="Text — e.g. Please upload your checkout photos for {{property}} before {{checkout_date}}."
                    maxLength={2000}
                  />
                )}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {["{{name}}", "{{email}}", "{{message}}"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => insertContentToken(b.id, t)}
                      className="rounded-md border border-ink-200 px-2 py-1 font-mono text-xs text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-900"
                    >
                      {t}
                    </button>
                  ))}
                  {customFields
                    .filter((f) => f.label.trim())
                    .map((f) => {
                      const tok = `{{${f.label.trim()}}}`;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => insertContentToken(b.id, tok)}
                          className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 font-mono text-xs text-brand-700 hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-900/40 dark:text-brand-100"
                        >
                          {tok}
                        </button>
                      );
                    })}
                  {/* Connected-table tokens: click to search + pick the exact field. */}
                  {(airtableConfig?.recordSources ?? [])
                    .filter((s) => s.alias.trim())
                    .map((s) => {
                      const t = airtableSchema.tables.find((tt) => tt.id === s.tableId);
                      return (
                        <TokenFieldPicker
                          key={s.id}
                          aliasKey={prefillKey(s.alias)}
                          fields={(t?.fields ?? []).map((f) => f.name)}
                          onInsert={(tok) => insertContentToken(b.id, tok)}
                        />
                      );
                    })}
                </div>
                {(b.text ?? "").trim() && (
                  <p className="mt-1.5 text-xs text-ink-500">
                    Preview:{" "}
                    <span className={b.type === "heading" ? "font-semibold text-ink-800 dark:text-ink-100" : ""}>
                      {renderMergeTags(b.text ?? "", mergeSample)}
                    </span>
                  </p>
                )}
              </>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => addContentBlock("heading")} className="btn-secondary text-sm">
            + Heading
          </button>
          <button type="button" onClick={() => addContentBlock("text")} className="btn-secondary text-sm">
            + Text
          </button>
          <button type="button" onClick={() => addContentBlock("divider")} className="btn-secondary text-sm">
            + Divider
          </button>
        </div>
        <p className="text-xs text-ink-400">
          Merge tags pull from the link&apos;s URL — share{" "}
          <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?first_name=John</code> and{" "}
          <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">{"{{first_name}}"}</code> becomes
          &ldquo;John.&rdquo; Add a fallback with{" "}
          <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">{"{{first_name|there}}"}</code>.
        </p>
      </CollapsibleSection>

      {/* Sections */}
      <CollapsibleSection
        title="Sections"
        badge="Pro"
        description="Group your fields under headings. Define sections here, then set each field's Section in Custom fields below."
      >
        {sections.map((s, idx) => (
          <div key={s.id} className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-500">Section {idx + 1}</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveSection(s.id, "up")}
                  disabled={idx === 0}
                  className="rounded p-1 text-ink-400 enabled:hover:bg-ink-100 disabled:opacity-30 dark:enabled:hover:bg-ink-800"
                  aria-label="Move section up"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveSection(s.id, "down")}
                  disabled={idx === sections.length - 1}
                  className="rounded p-1 text-ink-400 enabled:hover:bg-ink-100 disabled:opacity-30 dark:enabled:hover:bg-ink-800"
                  aria-label="Move section down"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeSection(s.id)}
                  className="ml-1 text-xs text-red-600 hover:underline dark:text-red-300"
                >
                  Remove
                </button>
              </div>
            </div>
            <input
              className="input font-medium"
              value={s.heading ?? ""}
              onChange={(e) => updateSection(s.id, { heading: e.target.value })}
              placeholder="Section heading (e.g. Property details)"
              maxLength={200}
            />
            <textarea
              className="input min-h-[56px] text-sm"
              value={s.text ?? ""}
              onChange={(e) => updateSection(s.id, { text: e.target.value })}
              placeholder="Optional intro text for this section"
              maxLength={2000}
            />
          </div>
        ))}
        {sections.length < 30 && (
          <button type="button" onClick={addSection} className="btn-secondary text-sm">
            + Add section
          </button>
        )}
        <p className="text-xs text-ink-400">
          Fields with no section appear first, then each section in order (empty sections are hidden).
        </p>
      </CollapsibleSection>

      {/* Uploader form fields — built-in identity fields, atop the Fields group */}
      <CollapsibleSection title="Uploader form" description="What you ask visitors for (optional fields).">

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
            {prefillSources.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-400">Pull from a connected record:</span>
                {prefillSources.map((s) => (
                  <TokenFieldPicker
                    key={s.id}
                    aliasKey={prefillKey(s.alias)}
                    fields={(airtableSchema.tables.find((t) => t.id === s.tableId)?.fields ?? []).map((f) => f.name)}
                    onInsert={(tok) => setPrefillName((v) => (v.trim() ? `${v} ${tok}` : tok))}
                  />
                ))}
              </div>
            )}
            <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={hideName} onChange={(e) => setHideName(e.target.checked)} />
              Hide from uploader (attach silently)
            </label>
          </div>
          <div>
            <label className="label mb-1" htmlFor="prefill-email">Prefill email (optional)</label>
            <input id="prefill-email" className="input" value={prefillEmail} onChange={(e) => setPrefillEmail(e.target.value)} placeholder="e.g. maria@example.com" />
            {prefillSources.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-400">Pull from a connected record:</span>
                {prefillSources.map((s) => (
                  <TokenFieldPicker
                    key={s.id}
                    aliasKey={prefillKey(s.alias)}
                    fields={(airtableSchema.tables.find((t) => t.id === s.tableId)?.fields ?? []).map((f) => f.name)}
                    onInsert={(tok) => setPrefillEmail((v) => (v.trim() ? `${v} ${tok}` : tok))}
                  />
                ))}
              </div>
            )}
            <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={hideEmail} onChange={(e) => setHideEmail(e.target.checked)} />
              Hide from uploader (attach silently)
            </label>
          </div>
        </div>
        {prefillSources.length > 0 && (
          <p className="mt-2 text-xs text-ink-400">
            Tip: prefill the name with a connected field like{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 dark:bg-ink-900">{`{{cleaner.Name}}`}</code>{" "}
            so submissions show who filled them in instead of “Anonymous”.
          </p>
        )}
      </CollapsibleSection>

      {/* Custom fields */}
      <CollapsibleSection
        title="Custom fields"
        badge="Pro"
        description="Up to 50 of your own fields. Hidden + prefilled values get attached to every upload and flow into your webhook — perfect for tagging a cleaner's Airtable record ID, phone, etc."
      >

        {airtableConnected && (
          <div className="border-b border-ink-100 pb-3 dark:border-ink-800">
            <AirtableImport
              onImport={importAirtableFields}
              defaultBaseId={airtableConfig?.baseId ?? ""}
              defaultBaseName={airtableConfig?.baseName ?? ""}
            />
          </div>
        )}

        {customFields.map((f, idx) => {
          const controllers = customFields.filter((c) => isController(c, f.id));
          const sw = f.showWhen;
          // Resolve the controller's TYPE + options. A connected-record controller
          // (sw.source set) derives its type from the Airtable field; otherwise it's
          // the controlling custom field.
          let controllerType: CustomFieldDef["type"] = "text";
          let controllerOptions: string[] = [];
          if (sw?.source) {
            const src = prefillSources.find((s) => prefillKey(s.alias) === sw.source);
            const tbl = src ? airtableSchema.tables.find((t) => t.id === src.tableId) : null;
            const fld = tbl?.fields.find((ff) => prefillKey(ff.name) === sw.fieldId) ?? null;
            controllerType = airtableTypeToFieldType(fld?.type);
            controllerOptions = fld?.options ?? [];
          } else if (sw) {
            const controller = customFields.find((c) => c.id === sw.fieldId) ?? null;
            controllerType = controller?.type ?? "text";
            controllerOptions =
              controllerType === "select" || controllerType === "multiselect"
                ? (controller?.options ?? []).map((o) => o.trim()).filter(Boolean)
                : [];
          }
          const conditionOps = operatorsForType(controllerType);
          const currentOp: FieldConditionOp = sw?.op ?? conditionOps[0]?.op ?? "is_filled";
          const conditionMode = conditionValueMode(currentOp, controllerType);
          // Whether any controller exists at all (sibling field or connected source).
          const hasAnyController = controllers.length > 0 || prefillSources.length > 0;
          const fieldInvalid = invalidFieldIds.has(f.id);
          return (
          <div
            key={f.id}
            className={`rounded-lg border p-3 ${
              fieldInvalid
                ? "border-red-300 ring-1 ring-red-300 dark:border-red-800 dark:ring-red-800"
                : "border-ink-200 dark:border-ink-700"
            }`}
          >
            {fieldInvalid && (
              <p className="mb-2 text-xs font-medium text-red-600 dark:text-red-300">
                This field needs attention — see the summary below.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="input"
                value={f.label}
                onChange={(e) => updateCustomField(f.id, { label: e.target.value })}
                placeholder="Field name or question (e.g. Any other notes?)"
                maxLength={1000}
              />
              <select
                className="input"
                value={f.type ?? "text"}
                onChange={(e) => setCustomFieldType(f.id, e.target.value as CustomFieldDef["type"])}
                aria-label="Field type"
              >
                <option value="text">Single line text</option>
                <option value="longtext">Long text</option>
                <option value="checkbox">Checkbox</option>
                <option value="select">Single-select</option>
                <option value="multiselect">Multi-select</option>
                <option value="currency">Currency ($)</option>
                <option value="number">Number</option>
                <option value="phone">Phone number</option>
                <option value="email">Email</option>
              </select>
            </div>

            {(f.type ?? "text") === "checkbox" ? (
              <label className="mt-2 flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
                <input
                  type="checkbox"
                  checked={f.value === "Yes"}
                  onChange={(e) => updateCustomField(f.id, { value: e.target.checked ? "Yes" : "" })}
                />
                Checked by default
              </label>
            ) : (f.type ?? "text") !== "select" && (f.type ?? "text") !== "multiselect" ? (
              <input
                className="input mt-2"
                value={f.value}
                onChange={(e) => updateCustomField(f.id, { value: e.target.value })}
                placeholder={
                  f.type === "currency"
                    ? "Default amount (optional)"
                    : f.type === "number"
                      ? "Default number (optional)"
                      : f.type === "phone"
                        ? "Default phone (optional)"
                        : f.type === "email"
                          ? "Default email (optional)"
                          : "Default / prefilled value"
                }
                maxLength={1000}
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
                {f.type === "select" && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-ink-500">Display as</span>
                    <select
                      className="input w-auto py-1 text-xs"
                      value={f.optionStyle ?? "dropdown"}
                      onChange={(e) =>
                        updateCustomField(f.id, { optionStyle: e.target.value as "dropdown" | "buttons" })
                      }
                    >
                      <option value="dropdown">Dropdown</option>
                      <option value="buttons">Buttons (click to pick)</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {sections.length > 0 && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-ink-500">Section</span>
                <select
                  className="input w-auto py-1 text-xs"
                  value={f.sectionId ?? ""}
                  onChange={(e) => updateCustomField(f.id, { sectionId: e.target.value || null })}
                >
                  <option value="">No section</option>
                  {sections.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      {s.heading?.trim() || `Section ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {f.visible && (
              <div className="mt-2 rounded-md bg-ink-50 p-2 dark:bg-ink-900/40">
                <label className="flex items-center gap-2 text-xs text-ink-600 dark:text-ink-300">
                  <input
                    type="checkbox"
                    checked={Boolean(f.showWhen)}
                    onChange={(e) => toggleShowWhen(f.id, e.target.checked)}
                  />
                  Only show this field conditionally
                </label>
                {f.showWhen &&
                  (!hasAnyController ? (
                    <p className="mt-1 text-xs text-ink-400">
                      Add another field above — or connect a data source — to control this one.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-ink-500">Show when</span>
                      <select
                        className="input w-auto py-1 text-xs"
                        value={f.showWhen.source ? `src:${f.showWhen.source}:${f.showWhen.fieldId}` : f.showWhen.fieldId}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("src:")) {
                            const rest = v.slice(4);
                            const sep = rest.indexOf(":");
                            const aliasKey = rest.slice(0, sep);
                            const fieldKey = rest.slice(sep + 1);
                            const src = prefillSources.find((s) => prefillKey(s.alias) === aliasKey);
                            const tbl = src ? airtableSchema.tables.find((t) => t.id === src.tableId) : null;
                            const fld = tbl?.fields.find((ff) => prefillKey(ff.name) === fieldKey) ?? null;
                            setShowWhenSource(f.id, aliasKey, fieldKey, airtableTypeToFieldType(fld?.type));
                          } else {
                            setShowWhenController(f.id, v);
                          }
                        }}
                      >
                        <option value="">Choose field…</option>
                        {controllers.length > 0 && (
                          <optgroup label="Another answer on this form">
                            {controllers.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label.trim()}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {prefillSources.map((s) => {
                          const aliasKey = prefillKey(s.alias);
                          const tbl = airtableSchema.tables.find((t) => t.id === s.tableId);
                          const flds = tbl?.fields ?? [];
                          if (flds.length === 0) return null;
                          return (
                            <optgroup key={s.id} label={`${s.label || s.alias} (connected record)`}>
                              {flds.map((ff) => (
                                <option key={ff.id} value={`src:${aliasKey}:${prefillKey(ff.name)}`}>
                                  {ff.name}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                      <select
                        className="input w-auto py-1 text-xs"
                        value={currentOp}
                        onChange={(e) => setShowWhenOp(f.id, e.target.value as FieldConditionOp)}
                      >
                        {conditionOps.map((o) => (
                          <option key={o.op} value={o.op}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {conditionMode === "text" && (
                        <input
                          className="input w-auto py-1 text-xs"
                          value={f.showWhen.values[0] ?? ""}
                          onChange={(e) => setShowWhenValue(f.id, e.target.value)}
                          placeholder="value"
                          maxLength={200}
                        />
                      )}
                      {conditionMode === "single-option" && (
                        <select
                          className="input w-auto py-1 text-xs"
                          value={f.showWhen.values[0] ?? ""}
                          onChange={(e) => setShowWhenValue(f.id, e.target.value)}
                        >
                          <option value="">Choose…</option>
                          {controllerOptions.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      )}
                      {conditionMode === "options" &&
                        (controllerOptions.length === 0 ? (
                          <span className="text-ink-400">That field has no options yet.</span>
                        ) : (
                          controllerOptions.map((o) => {
                            const checked = f.showWhen!.values.includes(o);
                            return (
                              <button
                                type="button"
                                key={o}
                                onClick={() => toggleShowWhenValue(f.id, o)}
                                className={
                                  checked
                                    ? "rounded-md border border-brand bg-brand-50 px-2 py-1 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
                                    : "rounded-md border border-ink-200 px-2 py-1 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300"
                                }
                              >
                                {o}
                              </button>
                            );
                          })
                        ))}
                    </div>
                  ))}
              </div>
            )}

            {f.label.trim() && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <span>URL prefill:</span>
                <code className="rounded bg-ink-100 px-1.5 py-0.5 dark:bg-ink-900">
                  ?{prefillKey(f.label)}=
                </code>
                <CopyButton value={prefillKey(f.label)} label="Copy key" />
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveCustomField(f.id, "up")}
                  disabled={idx === 0}
                  className="rounded p-1 text-ink-400 enabled:hover:bg-ink-100 enabled:hover:text-ink-700 disabled:opacity-30 dark:enabled:hover:bg-ink-800"
                  aria-label="Move field up"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveCustomField(f.id, "down")}
                  disabled={idx === customFields.length - 1}
                  className="rounded p-1 text-ink-400 enabled:hover:bg-ink-100 enabled:hover:text-ink-700 disabled:opacity-30 dark:enabled:hover:bg-ink-800"
                  aria-label="Move field down"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
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
          );
        })}

        {customFields.length < 50 && (
          <button type="button" onClick={addCustomField} className="btn-secondary text-sm">
            + Add custom field
          </button>
        )}
        <p className="text-xs text-ink-400">
          Prefill any field from the URL using its key above — plus{" "}
          <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?name=</code>,{" "}
          <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?email=</code>,{" "}
          <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">?message=</code> for the
          built-ins. Hidden fields prefill silently — perfect for Airtable formulas that generate
          per-recipient links.
        </p>
      </CollapsibleSection>

      {/* File naming / Video title */}
      <CollapsibleSection
        title={isYouTube ? "Video title" : "File naming"}
        badge="Pro"
        description={
          isYouTube
            ? "Build each video's title from a template. Leave blank to use the uploaded file's name."
            : "Auto-rename uploaded files using a template. Leave blank to keep the original filenames. Great for searchable, organized uploads."
        }
      >
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
          {/* Connected-table tokens work in file names too — click to pick the field. */}
          {(airtableConfig?.recordSources ?? [])
            .filter((s) => s.alias.trim())
            .map((s) => {
              const t = airtableSchema.tables.find((tt) => tt.id === s.tableId);
              return (
                <TokenFieldPicker
                  key={s.id}
                  aliasKey={prefillKey(s.alias)}
                  fields={(t?.fields ?? []).map((f) => f.name)}
                  onInsert={(tok) => setFilenameTemplate((v) => (v ? `${v}-${tok}` : tok))}
                />
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
      </CollapsibleSection>

      {/* Video description (YouTube only) */}
      {isYouTube && (
        <CollapsibleSection
          title="Video description"
          badge="Pro"
          description="Auto-fill the YouTube description from the upload's details. Use the same tokens as the title — including hidden custom fields, the uploader's message, and the date. Leave blank for no description."
          defaultOpen
        >
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
        </CollapsibleSection>
      )}

      {/* Airtable mapping — the destination (create/update a record). The source
          (base + connected tables) lives in Connected data near the top. */}
      <CollapsibleSection
        title="Airtable mapping"
        badge="Pro"
        description="Optionally create or update an Airtable record on submit — fill its fields from the upload, custom fields, or any connected table."
      >
        <AirtableMappingEditor
          connected={airtableConnected}
          value={airtableConfig}
          onChange={setAirtableConfig}
          customFields={customFields}
          schema={airtableSchema}
        />
      </CollapsibleSection>

      {/* Notifications & webhook */}
      <CollapsibleSection title="Notifications & webhook" description="Choose how you hear about new uploads.">

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
      </CollapsibleSection>

      {/* Routing rules */}
      <CollapsibleSection
        title="Routing rules"
        badge="Pro"
        description="Send specific uploads to specific people. Add destinations in Settings → Notifications, then route here — e.g. when a field is “Maintenance needed,” notify your maintenance email."
      >

        {destinations.length === 0 && (
          <p className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-900/40">
            No destinations yet. Add an email destination in Settings &rarr; Notifications and it
            will appear here. (You can still use &ldquo;Email me&rdquo; on a rule.)
          </p>
        )}

        {rules.map((rule) => {
          // Two-pass so connected-record {{alias.Field}} tags resolve in the
          // preview (against sample/Preview-Mode values), then the {token} vocab.
          const messagePreview = renderText(
            renderMergeTags(rule.messageTemplate ?? "", mergeSample),
            previewCtx,
          );
          return (
            <div key={rule.id} className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
              <input
                className="input"
                value={rule.name}
                onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                placeholder="Rule name (e.g. Maintenance alerts)"
                maxLength={80}
              />

              {/* Conditions */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-ink-500">When</span>
                  {rule.conditions.length > 1 && (
                    <>
                      <select
                        className="input w-auto"
                        value={rule.matchMode}
                        onChange={(e) => updateRule(rule.id, { matchMode: e.target.value as "all" | "any" })}
                      >
                        <option value="all">all</option>
                        <option value="any">any</option>
                      </select>
                      <span className="text-ink-500">of these match:</span>
                    </>
                  )}
                  {rule.conditions.length === 0 && <span className="text-ink-500">— always</span>}
                </div>

                {rule.conditions.map((c, idx) => {
                  const condType: CustomFieldDef["type"] =
                    c.field === "__fileType"
                      ? "select"
                      : customFields.find((f) => f.label.trim() === c.field)?.type ?? "text";
                  const condOps = operatorsForType(condType);
                  const currentOp: FieldConditionOp = c.op ?? condOps[0]?.op ?? "is_filled";
                  const condMode = conditionValueMode(currentOp, condType);
                  const optionList = ruleValueOptions(c.field) ?? [];
                  const selected = c.values?.length ? c.values : c.value ? [c.value] : [];
                  return (
                    <div key={idx} className="flex flex-wrap items-center gap-2 text-sm">
                      <select
                        className="input w-auto"
                        value={c.field}
                        onChange={(e) => {
                          const field = e.target.value;
                          const t: CustomFieldDef["type"] =
                            field === "__fileType"
                              ? "select"
                              : customFields.find((f) => f.label.trim() === field)?.type ?? "text";
                          updateCondition(rule.id, idx, {
                            field,
                            op: defaultOpForType(t),
                            values: [],
                            value: "",
                          });
                        }}
                      >
                        <option value="__fileType">File type</option>
                        {customFields
                          .filter((f) => f.label.trim())
                          .map((f) => (
                            <option key={f.id} value={f.label.trim()}>
                              {f.label.trim()}
                            </option>
                          ))}
                      </select>
                      <select
                        className="input w-auto"
                        value={currentOp}
                        onChange={(e) =>
                          updateCondition(rule.id, idx, {
                            op: e.target.value as FieldConditionOp,
                            values: [],
                            value: "",
                          })
                        }
                      >
                        {condOps.map((o) => (
                          <option key={o.op} value={o.op}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {condMode === "text" && (
                        <input
                          className="input w-auto"
                          value={selected[0] ?? ""}
                          onChange={(e) =>
                            updateCondition(rule.id, idx, {
                              values: e.target.value ? [e.target.value] : [],
                              value: e.target.value,
                            })
                          }
                          placeholder="value"
                          maxLength={200}
                        />
                      )}
                      {condMode === "single-option" && (
                        <select
                          className="input w-auto"
                          value={selected[0] ?? ""}
                          onChange={(e) =>
                            updateCondition(rule.id, idx, {
                              values: e.target.value ? [e.target.value] : [],
                              value: e.target.value,
                            })
                          }
                        >
                          <option value="">Choose…</option>
                          {optionList.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      )}
                      {condMode === "options" &&
                        (optionList.length === 0 ? (
                          <span className="text-ink-400">No options yet.</span>
                        ) : (
                          optionList.map((o) => {
                            const checked = selected.includes(o);
                            return (
                              <button
                                type="button"
                                key={o}
                                onClick={() =>
                                  updateCondition(rule.id, idx, {
                                    values: checked
                                      ? selected.filter((v) => v !== o)
                                      : [...selected, o],
                                  })
                                }
                                className={
                                  checked
                                    ? "rounded-md border border-brand bg-brand-50 px-2 py-1 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
                                    : "rounded-md border border-ink-200 px-2 py-1 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300"
                                }
                              >
                                {o}
                              </button>
                            );
                          })
                        ))}
                      <button
                        type="button"
                        onClick={() => removeCondition(rule.id, idx)}
                        className="px-2 text-lg leading-none text-ink-400 hover:text-red-600"
                        aria-label="Remove condition"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}

                {rule.conditions.length < 5 && (
                  <button
                    type="button"
                    onClick={() => addCondition(rule.id)}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    + Add condition
                  </button>
                )}
              </div>

              {/* Then notify */}
              <div className="space-y-1">
                <span className="label">Then notify</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {destinations.map((d) => (
                    <label key={d.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={rule.destinationIds.includes(d.id)}
                        onChange={() => toggleRuleDestination(rule.id, d.id)}
                      />
                      {d.label}
                    </label>
                  ))}
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={rule.ownerEmail}
                      onChange={() => updateRule(rule.id, { ownerEmail: !rule.ownerEmail })}
                    />
                    Email me
                  </label>
                </div>
                <label className="mt-1 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={rule.includeFiles !== false}
                    onChange={(e) => updateRule(rule.id, { includeFiles: e.target.checked })}
                  />
                  <span>
                    Include links to the uploaded files
                    <span className="block text-xs font-normal text-ink-400">
                      On by default. Email &amp; Slack list each file; text messages link to the
                      submission page (which shows them all). Turn off to notify without exposing
                      any file links.
                    </span>
                  </span>
                </label>
              </div>

              {/* Dynamic recipients — notify a person pulled from a connected record */}
              {(airtableConfig?.recordSources ?? []).some((s) => s.tableId && s.alias.trim()) && (
                <div className="space-y-2 border-t border-ink-100 pt-2 dark:border-ink-800">
                  <span className="label">
                    Notify a person from a connected record{" "}
                    <span className="font-normal text-ink-400">(optional)</span>
                  </span>
                  {(rule.dynamicRecipients ?? []).map((dr) => {
                    const sourceList = (airtableConfig?.recordSources ?? []).filter(
                      (s) => s.tableId && s.alias.trim(),
                    );
                    const src = sourceList.find((s) => prefillKey(s.alias) === dr.source);
                    const srcTable = src ? airtableSchema.tables.find((t) => t.id === src.tableId) : null;
                    const quoDests = destinations.filter((d) => d.type === "quo");
                    return (
                      <div key={dr.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <select
                          className="input w-auto"
                          value={dr.channel}
                          onChange={(e) =>
                            updateDynamicRecipient(rule.id, dr.id, { channel: e.target.value as "sms" | "email" })
                          }
                        >
                          <option value="sms">SMS</option>
                          <option value="email">Email</option>
                        </select>
                        <span className="text-ink-400">to</span>
                        <select
                          className="input w-auto"
                          value={dr.source}
                          onChange={(e) => updateDynamicRecipient(rule.id, dr.id, { source: e.target.value, field: "" })}
                          aria-label="Recipient table"
                        >
                          <option value="">Table…</option>
                          {sourceList.map((s) => (
                            <option key={s.id} value={prefillKey(s.alias)}>
                              {s.alias.trim()}
                            </option>
                          ))}
                        </select>
                        <select
                          className="input w-auto"
                          value={dr.field}
                          onChange={(e) => updateDynamicRecipient(rule.id, dr.id, { field: e.target.value })}
                          disabled={!srcTable}
                          aria-label="Recipient field"
                        >
                          <option value="">{dr.channel === "sms" ? "Phone field…" : "Email field…"}</option>
                          {(srcTable?.fields ?? []).map((f) => (
                            <option key={f.id} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        {dr.channel === "sms" && (
                          <>
                            <span className="text-ink-400">via</span>
                            <select
                              className="input w-auto"
                              value={dr.viaDestinationId ?? ""}
                              onChange={(e) =>
                                updateDynamicRecipient(rule.id, dr.id, { viaDestinationId: e.target.value || null })
                              }
                              aria-label="Quo account for SMS"
                            >
                              <option value="">Quo account…</option>
                              {quoDests.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.label}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => removeDynamicRecipient(rule.id, dr.id)}
                          className="px-2 text-lg leading-none text-ink-400 hover:text-red-600"
                          aria-label="Remove recipient"
                        >
                          &times;
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => addDynamicRecipient(rule.id)}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    + Add a dynamic recipient
                  </button>
                  <p className="text-xs text-ink-400">
                    Sends to the phone/email on the connected record passed into the link (e.g. SMS the
                    cleaner, email the owner). SMS needs a Quo account in Settings for the sending number.
                  </p>
                </div>
              )}

              {/* Custom message (SMS + Slack) */}
              <div className="space-y-1.5 border-t border-ink-100 pt-2 dark:border-ink-800">
                <span className="label">
                  Message <span className="font-normal text-ink-400">(SMS &amp; Slack — optional)</span>
                </span>
                <textarea
                  className="input min-h-[72px] text-sm"
                  value={rule.messageTemplate ?? ""}
                  onChange={(e) => updateRule(rule.id, { messageTemplate: e.target.value })}
                  placeholder={"Hey Mike, new maintenance video: {link}\n\nNote from cleaner: {message}\n\nText back with questions."}
                  maxLength={1000}
                />
                <div className="flex flex-wrap gap-1.5">
                  {["{name}", "{message}", "{link}", "{submission}", "{date}", "{count}"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => insertRuleToken(rule.id, t)}
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
                          onClick={() => insertRuleToken(rule.id, tok)}
                          className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 font-mono text-xs text-brand-700 hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-900/40 dark:text-brand-100"
                        >
                          {tok}
                        </button>
                      );
                    })}
                  {/* Connected-table tokens — click to pick a field. */}
                  {(airtableConfig?.recordSources ?? [])
                    .filter((s) => s.alias.trim())
                    .map((s) => {
                      const t = airtableSchema.tables.find((tt) => tt.id === s.tableId);
                      return (
                        <TokenFieldPicker
                          key={s.id}
                          aliasKey={prefillKey(s.alias)}
                          fields={(t?.fields ?? []).map((f) => f.name)}
                          onInsert={(tok) => insertRuleToken(rule.id, tok)}
                        />
                      );
                    })}
                </div>
                {(rule.messageTemplate ?? "").trim() && (
                  <div className="text-xs text-ink-500">
                    <span className="block">Preview:</span>
                    <pre className="mt-1 whitespace-pre-wrap rounded bg-ink-100 px-2 py-1.5 font-sans dark:bg-ink-900">{messagePreview}</pre>
                  </div>
                )}
                <p className="text-xs text-ink-400">
                  Leave blank for the default summary. (Email always uses the full formatted layout.)
                </p>
              </div>

              <button
                type="button"
                onClick={() => removeRule(rule.id)}
                className="text-xs text-red-600 hover:underline dark:text-red-300"
              >
                Remove rule
              </button>
            </div>
          );
        })}

        {rules.length < 10 && (
          <button type="button" onClick={addRule} className="btn-secondary text-sm">
            + Add rule
          </button>
        )}
      </CollapsibleSection>

      {/* After upload */}
      <CollapsibleSection title="After upload" description="What the uploader sees once their files finish.">
        <div>
          <label className="label mb-1" htmlFor="success-message">
            Success message <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            id="success-message"
            className="input"
            value={successMessage}
            onChange={(e) => setSuccessMessage(e.target.value)}
            placeholder="Thanks {{guest.First Name}}! Your photos were received."
            maxLength={500}
          />
          {prefillSources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-400">Personalize with a connected field:</span>
              {prefillSources.map((s) => (
                <TokenFieldPicker
                  key={s.id}
                  aliasKey={prefillKey(s.alias)}
                  fields={(airtableSchema.tables.find((t) => t.id === s.tableId)?.fields ?? []).map((f) => f.name)}
                  onInsert={(tok) => setSuccessMessage((v) => (v ? `${v}${tok}` : tok))}
                />
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-ink-400">
            Replaces the default confirmation text on the success screen. Use{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 dark:bg-ink-900">{`{{name}}`}</code> or a
            connected field to greet by name.
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
      </CollapsibleSection>

      {(error || issues.length > 0) && (
        <div
          ref={errorBannerRef}
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100"
        >
          {issues.length > 0 ? (
            <>
              <p className="font-medium">
                Please fix {issues.length === 1 ? "this" : `these ${issues.length}`} before saving:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {issues.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </>
          ) : (
            error
          )}
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

function humanizeError(code?: string): string {
  switch (code) {
    case "connection_not_found":
      return "That Google account connection couldn't be found. Reconnect it in Settings.";
    case "invalid_request":
      return "Some fields are invalid. Double-check the form and try again.";
    case "invalid_webhook":
      return "That webhook URL isn’t allowed — it must be a public https:// URL (no localhost or private addresses).";
    case "not_found":
      return "This link no longer exists.";
    default:
      return "Couldn't save the link. Please try again.";
  }
}
