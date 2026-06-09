-- =============================================================================
-- Upgrade: submissions (Phase 1 foundation) — a first-class submission object.
-- =============================================================================
-- A submission = one public form submit. It groups the form answers + uploader
-- context and 0..N uploaded files (uploads.submission_id). A batched multi-file
-- upload shares ONE submission (unique batch_id). Future-friendly columns
-- (submission_type, tags, status, source_block_id) are added now even if lightly
-- used, so multi-box forms + the inbox never require another migration.
-- Safe to run once; the backfill only touches uploads that lack a submission.
-- =============================================================================

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  upload_link_id uuid not null references public.upload_links(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- One submission per browser batch; null for single-file / form submits.
  batch_id uuid unique,
  submission_type text not null default 'upload'
    check (submission_type in ('upload', 'form', 'media')),
  uploader_name text,
  uploader_email text,
  uploader_message text,
  custom_data jsonb not null default '{}'::jsonb,
  tags text[],
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'done', 'archived')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists submissions_link_idx on public.submissions (upload_link_id, created_at desc);
create index if not exists submissions_user_idx on public.submissions (user_id, created_at desc);

alter table public.submissions enable row level security;
drop policy if exists "submissions: owner can read" on public.submissions;
create policy "submissions: owner can read"
  on public.submissions for select
  using (auth.uid() = user_id);
drop policy if exists "submissions: owner can update" on public.submissions;
create policy "submissions: owner can update"
  on public.submissions for update
  using (auth.uid() = user_id);

grant select, update on public.submissions to authenticated;
grant all on public.submissions to service_role;

-- Link uploads → their submission (nullable; set on insert going forward).
-- source_block_id: which upload box (block) a file came from (multi-box, later).
alter table public.uploads add column if not exists submission_id uuid
  references public.submissions(id) on delete set null;
alter table public.uploads add column if not exists source_block_id text;
create index if not exists uploads_submission_id_idx on public.uploads (submission_id);

-- ---------------------------------------------------------------------------
-- Backfill (idempotent). Only fills uploads that don't yet have a submission.
-- ---------------------------------------------------------------------------
-- Batched groups → one submission each (representative values are identical
-- across a batch; we take the earliest row's).
insert into public.submissions
  (upload_link_id, user_id, batch_id, submission_type,
   uploader_name, uploader_email, uploader_message, custom_data,
   status, created_at, completed_at)
select
  u.upload_link_id,
  u.user_id,
  u.batch_id,
  'upload',
  (array_agg(u.uploader_name order by u.created_at))[1],
  (array_agg(u.uploader_email order by u.created_at))[1],
  (array_agg(u.uploader_message order by u.created_at))[1],
  (array_agg(u.custom_data order by u.created_at))[1],
  'new',
  min(u.created_at),
  max(u.completed_at)
from public.uploads u
where u.batch_id is not null
  and u.submission_id is null
group by u.upload_link_id, u.user_id, u.batch_id
on conflict (batch_id) do nothing;

update public.uploads u
set submission_id = s.id
from public.submissions s
where u.batch_id is not null
  and u.submission_id is null
  and s.batch_id = u.batch_id;

-- Non-batched uploads → one submission each (loop to correlate 1:1).
do $$
declare
  r record;
  sid uuid;
begin
  for r in
    select * from public.uploads where batch_id is null and submission_id is null
  loop
    insert into public.submissions
      (upload_link_id, user_id, batch_id, submission_type,
       uploader_name, uploader_email, uploader_message, custom_data,
       status, created_at, completed_at)
    values
      (r.upload_link_id, r.user_id, null, 'upload',
       r.uploader_name, r.uploader_email, r.uploader_message, coalesce(r.custom_data, '{}'::jsonb),
       'new', r.created_at, r.completed_at)
    returning id into sid;
    update public.uploads set submission_id = sid where id = r.id;
  end loop;
end $$;
