alter table public.upload_links add column if not exists webhook_url text;
alter table public.upload_links add column if not exists webhook_secret text;

update public.upload_links
set webhook_secret = encode(gen_random_bytes(24), 'hex')
where webhook_secret is null;
