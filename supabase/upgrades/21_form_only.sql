-- =============================================================================
-- Upgrade: form-only links — a link can collect form answers with NO file
-- upload (no storage account needed).
-- =============================================================================
-- Adds destination_type (drive | youtube | form), backfills it from each link's
-- connection provider, and relaxes the storage/folder NOT NULL constraints so a
-- form-only link (and its file-less "carrier" submission) can omit them.
-- Also re-creates the public view to expose destination_type (keeping the
-- showWhen projection from migration 20). Safe to run once.
-- =============================================================================

alter table public.upload_links
  add column if not exists destination_type text not null default 'drive'
    check (destination_type in ('drive', 'youtube', 'form'));
alter table public.upload_links alter column storage_connection_id drop not null;
alter table public.upload_links alter column folder_id drop not null;

-- Backfill: existing links that point at a YouTube connection are 'youtube'.
update public.upload_links l
set destination_type = 'youtube'
from public.storage_connections c
where l.storage_connection_id = c.id
  and c.provider = 'youtube'
  and l.destination_type <> 'youtube';

-- A form-only submission stores a file-less "carrier" upload row, so uploads
-- must allow null storage/folder too.
alter table public.uploads alter column storage_connection_id drop not null;
alter table public.uploads alter column folder_id drop not null;

create or replace view public.upload_links_public as
select
  l.id,
  l.slug,
  l.name,
  l.description,
  l.destination_type,
  l.is_active,
  l.expires_at,
  l.max_file_size_mb,
  l.allowed_mime_types,
  l.require_name,
  l.require_email,
  l.show_message_field,
  l.hide_name,
  l.hide_email,
  case when l.hide_name then null else l.prefill_name end as prefill_name,
  case when l.hide_email then null else l.prefill_email end as prefill_email,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e->>'id',
      'label', e->>'label',
      'value', e->>'value',
      'required', coalesce((e->>'required')::boolean, false),
      'type', coalesce(e->>'type', 'text'),
      'options', coalesce(e->'options', '[]'::jsonb),
      'showWhen', e->'showWhen'
    ))
    from jsonb_array_elements(l.custom_fields) e
    where coalesce((e->>'visible')::boolean, false) = true
  ), '[]'::jsonb) as visible_custom_fields,
  coalesce(l.branding_logo_url, p.logo_url) as branding_logo_url,
  l.branding_color,
  l.success_message,
  l.success_redirect_url,
  (l.upload_password is not null and l.upload_password <> '') as requires_password
from public.upload_links l
join public.profiles p on p.id = l.user_id
where l.is_active = true
  and (l.expires_at is null or l.expires_at > now());

grant select on public.upload_links_public to anon, authenticated;
