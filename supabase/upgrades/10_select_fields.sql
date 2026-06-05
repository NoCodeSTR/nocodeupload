-- =============================================================================
-- Upgrade: single/multi-select custom fields (Wave 3, feature #2)
-- =============================================================================
-- Custom fields live inside upload_links.custom_fields (jsonb), so no column
-- changes are needed — each field object simply gains "type" and "options".
-- The only change here is the public view, which must now project those two
-- fields so the public upload page can render dropdowns / checkboxes.
-- No data is lost (a view is just a query). Safe to run once.
-- =============================================================================

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
      'required', coalesce((e->>'required')::boolean, false),
      'type', coalesce(e->>'type', 'text'),
      'options', coalesce(e->'options', '[]'::jsonb)
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
