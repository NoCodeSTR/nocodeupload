-- =============================================================================
-- Upgrade: Tags (reusable, cross-cutting labels for upload links)
-- =============================================================================
-- tags: owner-defined labels (e.g. "Cleaners", "Property A") — a reusable
--   vocabulary that grows as the owner adds them.
-- link_tags: many-to-many between upload_links and tags. user_id is carried for
--   simple owner RLS. Deleting a link or tag cascades the join rows.
-- Safe to run once.
-- =============================================================================

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists tags_user_id_idx on public.tags (user_id);

alter table public.tags enable row level security;
drop policy if exists "tags: owner all" on public.tags;
create policy "tags: owner all"
  on public.tags for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.tags to authenticated;
grant all on public.tags to service_role;

create table if not exists public.link_tags (
  link_id uuid not null references public.upload_links(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (link_id, tag_id)
);
create index if not exists link_tags_user_id_idx on public.link_tags (user_id);
create index if not exists link_tags_tag_id_idx on public.link_tags (tag_id);

alter table public.link_tags enable row level security;
drop policy if exists "link_tags: owner all" on public.link_tags;
create policy "link_tags: owner all"
  on public.link_tags for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.link_tags to authenticated;
grant all on public.link_tags to service_role;
