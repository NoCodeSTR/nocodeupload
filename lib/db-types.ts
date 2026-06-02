/**
 * Hand-maintained row types matching the SQL schema in
 * supabase/migrations/. Replace with generated types
 * (supabase gen types typescript) once the project is hosted.
 */

/**
 * Discriminator for `storage_connections.provider`. New providers add a
 * value here and a matching adapter under `lib/providers/<provider>/`.
 */
export type StorageProvider = "google_drive" | "dropbox" | "box" | "onedrive";

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  logo_url: string | null;
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
  branding_logo_url: string | null;
  branding_color: string | null;
  created_at: string;
  updated_at: string;
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
  branding_logo_url: string | null;
  branding_color: string | null;
}
