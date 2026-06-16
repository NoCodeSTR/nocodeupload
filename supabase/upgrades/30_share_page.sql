-- =============================================================================
-- Upgrade: branded public share page per submission.
-- =============================================================================
-- A link can expose each submission on a clean, branded public page (reached by
-- an unguessable signed token) so owners — and anyone they forward the link to —
-- can view the uploaded files (and optionally the form answers) without a login
-- and without making the underlying Drive files public (files stream through a
-- signed proxy gated on this setting).
--
--   off                → no public share page (default).
--   files              → page shows the uploaded files only.
--   files_and_answers  → page also shows the submitted form answers.
--
-- Server-side only (the page + file proxy load via the service role by token),
-- so the public uploader view is unchanged. Safe to run once.
-- =============================================================================

alter table public.upload_links
  add column if not exists share_page_mode text not null default 'off'
    check (share_page_mode in ('off', 'files', 'files_and_answers'));
