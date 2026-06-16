/**
 * Hand-maintained row types matching the SQL schema in
 * supabase/migrations/. Replace with generated types
 * (supabase gen types typescript) once the project is hosted.
 */

/**
 * Discriminator for `storage_connections.provider`. New providers add a
 * value here and a matching adapter under `lib/providers/<provider>/`.
 */
export type StorageProvider = "google_drive" | "dropbox" | "box" | "onedrive" | "youtube";

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  logo_url: string | null;
  /** Set true once we've emailed the admin about this new signup (fire-once). */
  signup_notified: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A user's connection to one account on one storage provider. Replaces the
 * pre-refactor `google_accounts` table. Tokens are AES-256-GCM ciphertext.
 */
export interface StorageConnectionRow {
  id: string;
  user_id: string;
  provider: StorageProvider;
  /** The provider's stable account ID (Google `sub`, Dropbox `account_id`, etc.) */
  provider_account_id: string;
  /** Display email for this account (informational, may be null on some providers) */
  provider_email: string | null;

  // AES-256-GCM blobs — base64-encoded
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_auth_tag: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;

  token_expires_at: string;
  scopes: string[];

  /**
   * Per-provider extension fields. Adapter-owned shape. The rest of the app
   * treats this as opaque. Examples:
   *   Google:   { user_picture_url, domain }
   *   Dropbox:  { team_member_id, team_name }
   *   OneDrive: { drive_id, tenant_id }
   */
  provider_metadata: Record<string, unknown>;

  status: "active" | "revoked" | "error";
  connected_at: string;
  last_refreshed_at: string | null;
}

/**
 * One upload box on a multi-box link — its own destination + presentation.
 * Stored (full) in upload_links.upload_boxes; only a safe subset is exposed
 * publicly (PublicUploadBox).
 */
export interface UploadBox {
  id: string;
  label: string;
  instructions?: string | null;
  destinationType: "drive" | "youtube";
  connectionId: string;
  folderId: string | null;
  folderName: string | null;
  referenceImageUrl?: string | null;
  required?: boolean;
  /** Optional grouping into a form section (renders inside that section). */
  sectionId?: string | null;
}

/**
 * A presentational block shown atop the public form. heading/text support merge
 * tags ({{key}}); divider is a horizontal rule. Stored in content_blocks and
 * exposed publicly as-is (presentational, safe).
 */
export interface ContentBlock {
  id: string;
  type: "heading" | "text" | "divider";
  text?: string;
}

/** Public-safe projection of an upload box (no connection/folder ids). */
export interface PublicUploadBox {
  id: string;
  label: string;
  instructions?: string | null;
  referenceImageUrl?: string | null;
  required?: boolean;
  sectionId?: string | null;
}

export interface UploadLinkRow {
  id: string;
  user_id: string;
  /** Null for form-only links (no storage destination). */
  storage_connection_id: string | null;
  /** drive | youtube | form | multi. */
  destination_type: "drive" | "youtube" | "form" | "multi";
  slug: string;
  name: string;
  description: string | null;
  /** Provider-native folder identifier; null for YouTube/form-only. */
  folder_id: string | null;
  folder_name: string | null;
  is_active: boolean;
  expires_at: string | null;
  max_file_size_mb: number;
  allowed_mime_types: string[] | null;
  require_name: boolean;
  require_email: boolean;
  show_message_field: boolean;
  prefill_name: string | null;
  prefill_email: string | null;
  hide_name: boolean;
  hide_email: boolean;
  /** When true, the public form accepts a submission with zero files. */
  allow_empty_submission: boolean;
  /**
   * When true, each completed Drive file is granted "anyone with the link can
   * view" so notification file links work for external recipients. Default false.
   */
  public_files: boolean;
  /**
   * Branded public share page per submission: 'off' (none), 'files' (files
   * only), or 'files_and_answers' (files + form answers). Files stream through a
   * signed proxy so Drive stays private. Default 'off'.
   */
  share_page_mode: "off" | "files" | "files_and_answers";
  custom_fields: CustomFieldDef[];
  filename_template: string | null;
  description_template: string | null;
  notify_email: boolean;
  bundle_notifications: boolean;
  notification_rules: NotificationRule[];
  branding_logo_url: string | null;
  branding_color: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  success_message: string | null;
  success_redirect_url: string | null;
  upload_password: string | null;
  project_id: string | null;
  /** Optional Airtable destination (record creation alongside Drive). */
  airtable_config: AirtableConfig | null;
  /** Multi-box uploads (destination_type 'multi'); null otherwise. */
  upload_boxes: UploadBox[] | null;
  /** Ordered presentational blocks shown atop the public form. */
  content_blocks: ContentBlock[] | null;
  /** Ordered form sections that group fields under a heading + text. */
  sections: FormSection[] | null;
  created_at: string;
  updated_at: string;
}

// --- Airtable (Phase A: records alongside Drive) -----------------------------

/** A constant value written to a named Airtable field on every record. */
export interface AirtableStaticValue {
  field: string;
  value: string;
}

/**
 * One destination-oriented mapping: the Airtable field on the DESTINATION table
 * to fill (`field`) and the value `source` to fill it from (a source key — a
 * built-in like "link", a "field:<Label>", or a record source "ref:<alias>" /
 * "ref:<alias>:<Field>"). Destination-oriented so the builder shows only the
 * destination table's fields as the things that can be filled, while the value
 * can come from any connected table. Supersedes the legacy `mapping` map.
 */
export interface AirtableFieldMapping {
  field: string;
  source: string;
}

/**
 * A "record source" — another table in the SAME base whose record is referenced
 * by id (from the link URL via the alias, or a picker) so its fields can be
 * pulled LIVE and used as namespaced merge tags ({{alias.Field}}), and later
 * (Phase 2) prefilled into fields / mapped into the destination row. Generalizes
 * single-record personalization to several tables in one form, which solves the
 * "destination lookups are blank until submit" problem.
 *
 *   alias    URL key + merge namespace (e.g. "cleaner" → ?cleaner=recXXX,
 *            {{cleaner.Name}}). Normalized to its prefill-key form for matching.
 *   fields   the field NAMES to pull from the source record. Only these leave
 *            Airtable (the values are shipped to the browser for merge tags), so
 *            an empty list pulls nothing.
 *   visible  false = prefilled from the link URL (hidden, owner-controlled);
 *            true  = the uploader picks the record (Phase 3 type-to-search).
 */
export interface RecordSource {
  id: string;
  alias: string;
  label: string;
  tableId: string;
  tableName: string;
  fields: string[];
  visible: boolean;
  required?: boolean;
  instructions?: string | null;
}

/**
 * Per-link Airtable destination config (stored in upload_links.airtable_config).
 *
 *   recordMode    "per_upload" → one record per file; "per_batch" → one record
 *                 per multi-file submission (single files always get one record).
 *   attachFiles   when true, also copy the file(s) into an Airtable attachment
 *                 field (attachFieldName) via a temporary Drive share. Off by
 *                 default — link mode just writes the file's URL.
 *   mapping       LEGACY source key → destination field NAME map (read-only
 *                 fallback). New configs use `fieldMappings` (destination-
 *                 oriented). Built-in keys: link, filename, filetype, size,
 *                 name, email, message, date, count. Custom: "field:<Label>".
 *   fieldMappings destination-oriented mappings (see AirtableFieldMapping) — the
 *                 destination field to fill + the value source to fill it from.
 *   staticValues  constant field=value pairs written on every record.
 */
export interface AirtableConfig {
  enabled: boolean;
  baseId: string;
  baseName: string;
  tableId: string;
  tableName: string;
  recordMode: "per_upload" | "per_batch";
  attachFiles: boolean;
  attachFieldName: string | null;
  mapping: Record<string, string>;
  /** Destination-oriented field mappings (supersedes `mapping`). */
  fieldMappings?: AirtableFieldMapping[];
  staticValues: AirtableStaticValue[];
  /**
   * Opt-in: when true, a ?record=recXXX URL param looks up that record in this
   * link's base+table and exposes its columns as merge-tag values + field
   * prefills (read-only personalization). Requires data.records:read on the PAT.
   */
  allowRecordPrefill?: boolean;
  /**
   * Legacy two-way sync flag (pre-recordAction). When true AND a ?record= id is
   * present, UPDATE instead of create. Superseded by recordAction; kept for
   * back-compat (treated as recordAction "update", updateRecordSource "url").
   */
  updateRecordWhenPresent?: boolean;
  /**
   * Create a new record vs. update an existing one. Default "create".
   */
  recordAction?: "create" | "update";
  /**
   * Where the record id to UPDATE comes from: "url" (?record=recXXX) or a record
   * source alias key (e.g. "guest" → ?guest=recXXX, updating that record's
   * table). Only meaningful when recordAction is "update".
   */
  updateRecordSource?: string;
  /**
   * Record sources — other tables in the same base pulled in by id so their
   * fields are available live as namespaced merge tags ({{alias.Field}}). See
   * RecordSource. Empty/undefined = none.
   */
  recordSources?: RecordSource[];
}

/** A user's connected Airtable account (encrypted Personal Access Token). */
export interface AirtableConnectionRow {
  id: string;
  user_id: string;
  token_ciphertext: string;
  token_iv: string;
  token_auth_tag: string;
  created_at: string;
}

/** An owner-defined group for organizing upload links. */
export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

/** Input control type for a custom field. */
export type CustomFieldType =
  | "text"
  | "longtext"
  | "checkbox"
  | "select"
  | "multiselect"
  | "currency"
  | "number"
  | "phone"
  | "email";

/**
 * Conditional visibility operators (Airtable-style; the editor offers a
 * type-aware subset per controlling field). `is_filled`/`is_empty` need no
 * value; `has_any_of`/`has_none_of` use the values list; the rest use values[0].
 */
export type FieldConditionOp =
  | "is_filled"
  | "is_empty"
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "has_any_of"
  | "has_none_of"
  | "greater_than"
  | "less_than";

/**
 * Conditional visibility: show the field only when the controlling field
 * (referenced by its id) satisfies `op` against `values`. Any field type can be
 * a controller. `op` is optional for back-compat — older rules without it are
 * treated as `has_any_of` (show when the controller's value is one of values).
 */
export interface FieldCondition {
  fieldId: string;
  op?: FieldConditionOp;
  values: string[];
  /**
   * When set, the controller is a connected-record field rather than another
   * custom field: `source` is the connected source's alias key and `fieldId`
   * holds the source field key (prefillKey of the Airtable field name). The
   * controlling value is read from the resolved `${source}.${fieldId}` map.
   */
  source?: string;
}

/** A form section — groups fields under a heading + intro text. */
export interface FormSection {
  id: string;
  heading?: string;
  text?: string;
}

/** An owner-defined field on a link. */
export interface CustomFieldDef {
  id: string;
  label: string;
  value: string; // prefill / baked-in value (multiselect: comma-joined)
  visible: boolean; // shown to the uploader (editable) vs hidden (server-injected)
  required: boolean; // only meaningful when visible
  type?: CustomFieldType; // defaults to "text" when absent (back-compat)
  options?: string[]; // choices for select / multiselect
  showWhen?: FieldCondition | null; // optional conditional visibility
  sectionId?: string | null; // optional grouping into a form section
}

// --- Notifications v2 --------------------------------------------------------

export type NotificationDestinationType = "email" | "slack" | "quo";

/** A connected Slack workspace (bot token, encrypted). One per workspace. */
export interface SlackConnectionRow {
  id: string;
  user_id: string;
  team_id: string;
  team_name: string | null;
  bot_token_ciphertext: string;
  bot_token_iv: string;
  bot_token_auth_tag: string;
  created_at: string;
}

/** A reusable, account-level notification channel. */
export interface NotificationDestinationRow {
  id: string;
  user_id: string;
  type: NotificationDestinationType;
  label: string;
  /**
   * Adapter-owned. email: { address }. slack: { channel, team, and the
   * AES-GCM-encrypted incoming-webhook url as webhook_ciphertext/iv/auth_tag }.
   */
  config: Record<string, unknown>;
  created_at: string;
}

/** Legacy two-op type (pre-parity). Kept for back-compat reads. */
export type RuleConditionOp = "equals" | "contains";

/**
 * A single condition within a routing rule. Uses the same operator set as field
 * visibility (FieldConditionOp): is_filled, is_empty, equals, not_equals,
 * contains, not_contains, has_any_of, has_none_of, greater_than, less_than.
 */
export interface RuleCondition {
  /** A custom-field label, or the special token "__fileType". */
  field: string;
  op: FieldConditionOp;
  /** Comparison values (multiple for any-of / none-of). */
  values: string[];
  /** Legacy single value (pre-parity) — read as a values fallback. */
  value?: string;
}

/**
 * A dynamic recipient: send to a phone (SMS) or email pulled from a connected
 * record's field at submit time — e.g. SMS to the Cleaning Team's Phone, email
 * to the Property's Owner Email. `source` is a record-source alias key and
 * `field` is the column whose value is the recipient. For SMS, `viaDestinationId`
 * points at a Quo destination supplying the API key + from-number (only the
 * recipient is dynamic).
 */
export interface DynamicRecipient {
  id: string;
  channel: "sms" | "email";
  source: string;
  field: string;
  viaDestinationId?: string | null;
}

/**
 * A per-link routing rule. Empty `conditions` means "always". Matching rules
 * fan out to their destinations (and optionally the owner's account email).
 */
export interface NotificationRule {
  id: string;
  name: string;
  matchMode: "all" | "any";
  conditions: RuleCondition[];
  destinationIds: string[];
  ownerEmail: boolean;
  /** Optional custom message (tokens) for SMS + Slack. Blank = default summary. */
  messageTemplate?: string;
  /** Recipients resolved from connected-record fields (SMS/email). */
  dynamicRecipients?: DynamicRecipient[];
  /**
   * Whether this rule's email/Slack/SMS messages include links to the uploaded
   * files. Undefined = treat as true (legacy rules always included them). When
   * false, the rule notifies without exposing file/submission links.
   */
  includeFiles?: boolean;
}

/** One send attempt, logged for observability. */
export interface NotificationDeliveryRow {
  id: string;
  user_id: string;
  upload_link_id: string | null;
  batch_id: string | null;
  upload_id: string | null;
  channel: string;
  target: string | null;
  status: "sent" | "failed" | "skipped";
  detail: string | null;
  created_at: string;
}

/** The visible subset exposed by the public view (no hidden fields). */
export interface PublicCustomField {
  id: string;
  label: string;
  value: string;
  required: boolean;
  type?: CustomFieldType;
  options?: string[];
  showWhen?: FieldCondition | null;
  sectionId?: string | null;
}

export interface UploadRow {
  id: string;
  upload_link_id: string;
  user_id: string;
  storage_connection_id: string | null;
  folder_id: string | null;
  /** Provider-native file identifier (Drive fileId, Dropbox path/id, etc.) */
  provider_file_id: string | null;
  original_filename: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  uploader_name: string | null;
  uploader_email: string | null;
  uploader_message: string | null;
  uploader_ip_hash: string | null;
  custom_data: Record<string, string>;
  provider: StorageProvider | null;
  /** Files uploaded together in one submission share this id (null = single). */
  batch_id: string | null;
  /** Number of files the browser declared for this batch. */
  batch_size: number | null;
  /** Set once, on every row of a batch, when the bundled notification fires. */
  batch_notified_at: string | null;
  /** Single-create claim for the Airtable destination (per row or batch-wide). */
  airtable_recorded_at: string | null;
  /** The submission (one per batch / one per single file) this file belongs to. */
  submission_id: string | null;
  /** Which upload box (block) the file came from — multi-box forms (later). */
  source_block_id: string | null;
  /** Airtable record id this submission targets (two-way sync); null = create. */
  airtable_record_id: string | null;
  /** Resolved record-source ids for this submission: { aliasKey: recordId }. */
  source_record_ids: Record<string, string> | null;
  status: "uploading" | "complete" | "failed";
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * A submission — one public submit. Groups the form answers + uploader context
 * and 0..N files (uploads.submission_id). A batched multi-file upload shares one
 * submission (unique batch_id). submission_type, tags, and status are present
 * for the inbox + multi-box forms even where lightly used today.
 */
export interface SubmissionRow {
  id: string;
  upload_link_id: string;
  user_id: string;
  batch_id: string | null;
  submission_type: "upload" | "form" | "media";
  uploader_name: string | null;
  uploader_email: string | null;
  uploader_message: string | null;
  custom_data: Record<string, string> | null;
  tags: string[] | null;
  status: "new" | "in_progress" | "done" | "archived";
  created_at: string;
  completed_at: string | null;
}

/**
 * Read-only view exposed to anonymous uploaders. Excludes folder_id,
 * storage_connection_id, user_id, and provider.
 */
export interface UploadLinkPublicRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** drive | youtube | form | multi — drives how the public page renders. */
  destination_type: "drive" | "youtube" | "form" | "multi";
  is_active: boolean;
  expires_at: string | null;
  max_file_size_mb: number;
  allowed_mime_types: string[] | null;
  require_name: boolean;
  require_email: boolean;
  show_message_field: boolean;
  hide_name: boolean;
  hide_email: boolean;
  /** When true, the public form accepts a submission with zero files. */
  allow_empty_submission: boolean;
  prefill_name: string | null;
  prefill_email: string | null;
  visible_custom_fields: PublicCustomField[];
  /** Present for multi-box links (destination_type 'multi'); else []. */
  upload_boxes: PublicUploadBox[];
  /** Presentational blocks rendered atop the public form (merge tags applied). */
  content_blocks: ContentBlock[];
  /** Form sections that group fields (heading + text). */
  sections: FormSection[];
  branding_logo_url: string | null;
  branding_color: string | null;
  success_message: string | null;
  success_redirect_url: string | null;
  requires_password: boolean;
}
