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

export interface UploadLinkRow {
  id: string;
  user_id: string;
  storage_connection_id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Provider-native folder identifier (opaque to non-adapter code) */
  folder_id: string;
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
  created_at: string;
  updated_at: string;
}

/** Input control type for a custom field. */
export type CustomFieldType = "text" | "select" | "multiselect";

/** An owner-defined field on a link (max 3). */
export interface CustomFieldDef {
  id: string;
  label: string;
  value: string; // prefill / baked-in value (multiselect: comma-joined)
  visible: boolean; // shown to the uploader (editable) vs hidden (server-injected)
  required: boolean; // only meaningful when visible
  type?: CustomFieldType; // defaults to "text" when absent (back-compat)
  options?: string[]; // choices for select / multiselect
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

export type RuleConditionOp = "equals" | "contains";

/** A single condition within a routing rule. */
export interface RuleCondition {
  /** A custom-field label, or the special token "__fileType". */
  field: string;
  op: RuleConditionOp;
  value: string;
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
}

export interface UploadRow {
  id: string;
  upload_link_id: string;
  user_id: string;
  storage_connection_id: string;
  folder_id: string;
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
  status: "uploading" | "complete" | "failed";
  error_message: string | null;
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
  is_active: boolean;
  expires_at: string | null;
  max_file_size_mb: number;
  allowed_mime_types: string[] | null;
  require_name: boolean;
  require_email: boolean;
  show_message_field: boolean;
  hide_name: boolean;
  hide_email: boolean;
  prefill_name: string | null;
  prefill_email: string | null;
  visible_custom_fields: PublicCustomField[];
  branding_logo_url: string | null;
  branding_color: string | null;
  success_message: string | null;
  success_redirect_url: string | null;
  requires_password: boolean;
}
