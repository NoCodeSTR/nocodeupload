-- 40_schema_migrations.sql — the applied-migration ledger (Hardening Phase A).
--
-- Ends the reliance on chat history / hand-kept docs to know what ran. Every
-- FUTURE upgrade file records itself here as its final statement (see AGENTS.md).
-- Backfill below records everything through 39 as one verified historical batch
-- (per docs/MIGRATIONS.md, confirmed applied 2026-07; note 36 was never issued).
--
-- Service-role / dashboard only.
create table if not exists public.schema_migrations (
  version     text primary key,
  name        text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text
);
alter table public.schema_migrations enable row level security;
-- Deliberately no policies: service-role / SQL-editor only.

insert into public.schema_migrations (version, name, applied_by)
values
    ('00','init_base_schema'),
    ('01','provider_agnostic_refactor'),
    ('02','ensure_grants'),
    ('03','account_logo'),
    ('04','webhooks'),
    ('05','custom_fields'),
    ('06','naming_and_notifications'),
    ('07','youtube'),
    ('08','success_screen'),
    ('09','batches'),
    ('10','select_fields'),
    ('11','notifications_v2'),
    ('12','quo_destination'),
    ('13','signup_notify'),
    ('14','slack_bot'),
    ('15','link_password'),
    ('16','projects'),
    ('17','tags'),
    ('18','airtable'),
    ('19','submissions'),
    ('20','conditional_fields'),
    ('21','form_only'),
    ('22','multi_box'),
    ('23','content_blocks'),
    ('24','airtable_record_id'),
    ('25','sections'),
    ('26','box_sections'),
    ('27','record_sources'),
    ('28','empty_submission'),
    ('29','public_files'),
    ('30','share_page'),
    ('31','hide_title'),
    ('32','private_internal_note'),
    ('33','option_style'),
    ('34','submission_folders'),
    ('35','multibox_folders'),
    ('37','default_accent_color'),
    ('38','jobs_engine'),
    ('39','deliveries_job_id')
on conflict (version) do nothing;

-- This migration records ITSELF (the pattern every future migration follows):
insert into public.schema_migrations (version, name, applied_by)
values ('40','schema_migrations','dashboard')
on conflict (version) do nothing;
