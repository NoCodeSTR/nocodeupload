-- 37_default_accent_color.sql
-- Account-level default accent color. Seeds the brand color on every NEW upload
-- link the user creates; each link can still override it. Stored as a #rrggbb
-- hex string (nullable = no default set).
alter table public.profiles
  add column if not exists default_accent_color text;
