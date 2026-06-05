-- =============================================================================
-- Upgrade: post-upload success behavior (Wave 1, feature #4)
-- =============================================================================
-- - upload_links.success_message: optional copy shown on the success screen.
-- - upload_links.success_redirect_url: optional URL to send the uploader to
--   after a successful upload (instead of our built-in success screen).
-- - Re-create upload_links_public so the public page can read both.
-- Safe to run once.
-- =============================================================================

alter table public.upload_links add column if not exists success_message text;
alter table public.upload_links add column if not exists success_redirect_url text;

-- Recreate the public view to expose the two new fields. Mirrors the canonical
-- definition in the init migration. No data is lost (a view is just a query).
create or replace view public.upload_links_public as
select
  l.id,
  l.slug,
  l.name,
  l.description,
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
      'required', coalesce((e->>'required')::boolean, false)
    ))
    from jsonb_array_elements(l.custom_fields) e
    where coalesce((e->>'visible')::boolean, false) = true
  ), '[]'::jsonb) as visible_custom_fields,
  coalesce(l.branding_logo_url, p.logo_url) as branding_logo_url,
  l.branding_color,
  l.success_message,
  l.success_redirect_url
from public.upload_links l
join public.profiles p on p.id = l.user_id
where l.is_active = true
  and (l.expires_at is null or l.expires_at > now());

grant select on public.upload_links_public to anon, authenticated;
