-- =============================================================================
-- Upgrade: per-link webhooks (Zapier / Make / custom)
-- =============================================================================
-- Adds an optional webhook URL per upload link plus a signing secret used to
-- HMAC-sign the payload (header X-NoCodeUpload-Signature: sha256=...).
-- Backfills a secret for existing links. Safe to run once.
-- =============================================================================

alter table public.upload_links add column if not exists webhook_url text;
alter table public.upload_links add column if not exists webhook_secret text;

-- Give every existing link a signing secret (pgcrypto is enabled in the init migration).
update public.upload_links
set webhook_secret = encode(gen_random_bytes(24), 'hex')
where webhook_secret is null;
