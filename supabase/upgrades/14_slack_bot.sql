-- =============================================================================
-- Upgrade: Slack bot-token connections (channel/person picker)
-- =============================================================================
-- Moves Slack from one-webhook-per-channel to a workspace bot token, so owners
-- connect once and then pick any channel (+ an optional person to @mention)
-- from dropdowns. The bot token is stored encrypted, one row per workspace.
-- Slack channel destinations (in notification_destinations) reference a
-- connection by id and add channel_id + optional mention_user_id in config.
-- Safe to run once.
-- =============================================================================

create table if not exists public.slack_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id text not null,
  team_name text,
  bot_token_ciphertext text not null,
  bot_token_iv text not null,
  bot_token_auth_tag text not null,
  created_at timestamptz not null default now(),
  unique (user_id, team_id)
);
create index if not exists slack_connections_user_id_idx on public.slack_connections (user_id);

alter table public.slack_connections enable row level security;

drop policy if exists "slack_connections: owner all" on public.slack_connections;
create policy "slack_connections: owner all"
  on public.slack_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.slack_connections to authenticated;
grant all on public.slack_connections to service_role;
