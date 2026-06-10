-- =============================================================================
-- Upgrade: multi-box uploads — a link can have several labeled upload boxes,
-- each routed to its OWN destination (Drive folder or YouTube), with optional
-- instructions and a "match this" reference photo.
-- =============================================================================
-- upload_boxes jsonb on upload_links: array of { id, label, instructions,
--   destinationType (drive|youtube), connectionId, folderId, folderName,
--   referenceImageUrl, required }. destination_type gains 'multi'. The public
--   view exposes a SAFE subset of boxes (no connection/folder ids).
-- Safe to run once.
-- =============================================================================

alter table public.upload_links add column if not exists upload_boxes jsonb;

alter table public.upload_links drop constraint if exists upload_links_destination_type_check;
alter table public.upload_links
  add constraint upload_links_destination_type_check
  check (destination_type in ('drive', 'youtube', 'form', 'multi'));

-- Public view: add upload_boxes (safe subset only). DROP + CREATE because we're
-- adding a column mid-list (CREATE OR REPLACE can't reorder).
drop view if exists public.upload_links_public;
create view public.upload_links_public as
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
  -- Upload boxes — safe subset only (never expose connection/folder ids).
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b->>'id',
      'label', b->>'label',
      'instructions', b->>'instructions',
      'referenceImageUrl', b->>'referenceImageUrl',
      'required', coalesce((b->>'required')::boolean, false)
    ))
    from jsonb_array_elements(coalesce(l.upload_boxes, '[]'::jsonb)) b
  ), '[]'::jsonb) as upload_boxes,
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
