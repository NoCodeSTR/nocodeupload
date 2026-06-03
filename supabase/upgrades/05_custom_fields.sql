-- =============================================================================
-- Upgrade: tagged links — prefill/hide built-in fields + custom named fields
-- =============================================================================
-- Adds prefill + hide for the built-in name/email, plus up to 3 owner-defined
-- custom fields per link (each: id, label, value, visible, required). Resolved
-- values for each upload are stored in uploads.custom_data and flow into the
-- submissions view, webhook payload, and email.
--
-- The public view exposes ONLY visible custom fields (and masks prefilled
-- values of hidden built-ins) so hidden metadata never reaches the browser.
-- Safe to run once.
-- =============================================================================

alter table public.upload_links add column if not exists prefill_name text;
alter table public.upload_links add column if not exists prefill_email text;
alter table public.upload_links add column if not exists hide_name boolean not null default false;
alter table public.upload_links add column if not exists hide_email boolean not null default false;
alter table public.upload_links add column if not exists custom_fields jsonb not null default '[]'::jsonb;

alter table public.uploads add column if not exists custom_data jsonb not null default '{}'::jsonb;

-- Recreate the public view (DROP first: we're inserting columns, not just
-- appending, so CREATE OR REPLACE's column-order rule would reject it).
drop view if exists public.upload_links_public;
create view public.upload_links_public as
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
  -- Mask prefilled values of HIDDEN built-ins so they never reach the browser.
  case when l.hide_name then null else l.prefill_name end as prefill_name,
  case when l.hide_email then null else l.prefill_email end as prefill_email,
  -- Expose ONLY visible custom fields (id, label, prefill value, required).
  -- Hidden custom fields are excluded entirely — applied server-side at upload.
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
  l.branding_color
from public.upload_links l
join public.profiles p on p.id = l.user_id
where l.is_active = true
  and (l.expires_at is null or l.expires_at > now());

grant select on public.upload_links_public to anon, authenticated;
