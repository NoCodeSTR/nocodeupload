-- =============================================================================
-- Upgrade: allow form submission with no file upload.
-- =============================================================================
-- Some submitters (e.g. a cleaner with no photos this visit) need to send the
-- form answers without attaching any files. This flag lets the owner opt a link
-- into accepting a zero-file submission: the public uploader shows a "Submit
-- without files" path and the submit route stores a file-less carrier upload
-- (same shape form-only links already use) instead of rejecting the empty set.
--
-- The public view must project the flag so the uploader knows whether to offer
-- the no-file path. DROP + CREATE (not CREATE OR REPLACE): we append a column,
-- but keeping the full definition here documents the live view shape. Safe to
-- run once.
-- =============================================================================

alter table public.upload_links
  add column if not exists allow_empty_submission boolean not null default false;

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
  l.allow_empty_submission,
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
      'showWhen', e->'showWhen',
      'sectionId', e->>'sectionId'
    ))
    from jsonb_array_elements(l.custom_fields) e
    where coalesce((e->>'visible')::boolean, false) = true
  ), '[]'::jsonb) as visible_custom_fields,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b->>'id',
      'label', b->>'label',
      'instructions', b->>'instructions',
      'referenceImageUrl', b->>'referenceImageUrl',
      'required', coalesce((b->>'required')::boolean, false),
      'sectionId', b->>'sectionId'
    ))
    from jsonb_array_elements(coalesce(l.upload_boxes, '[]'::jsonb)) b
  ), '[]'::jsonb) as upload_boxes,
  coalesce(l.content_blocks, '[]'::jsonb) as content_blocks,
  coalesce(l.sections, '[]'::jsonb) as sections,
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
