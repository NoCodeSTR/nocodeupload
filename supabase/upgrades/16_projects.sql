-- =============================================================================
-- Upgrade: Projects (organize upload links into groups)
-- =============================================================================
-- A "project" is an owner-defined group for upload links (e.g. "Property A",
-- "Cleaners"). Each link can belong to at most one project (nullable). Named
-- "project" — NOT "folder" — to avoid confusion with the Drive destination
-- folder (upload_links.folder_id).
-- Safe to run once.
-- =============================================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists projects_user_id_idx on public.projects (user_id);

alter table public.projects enable row level security;

drop policy if exists "projects: owner all" on public.projects;
create policy "projects: owner all"
  on public.projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;

-- Link → project (nullable; deleting a project just unassigns its links).
alter table public.upload_links
  add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists upload_links_project_id_idx on public.upload_links (project_id);
