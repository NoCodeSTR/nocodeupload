# NoCode Upload — Migration Status Manifest

**How migrations work here:** `supabase/migrations/20260527000000_init.sql` is the **base schema**.
Everything after is an ordered **upgrade** in `supabase/upgrades/NN_*.sql`, applied **manually** via
the Supabase SQL editor, **in numeric order**. A fresh database must run **init, then every upgrade
01→35 in order**.

**⚠️ Production applied-state cannot be proven from this repo.** Anything not provably applied is
marked **Confirm w/ Sean**. Do **not** claim a migration is live without evidence.

- **In init?** — Whether the change is already in the canonical `20260527000000_init.sql`.
  Upgrades live in separate files, so this is **No** for all of them; **init currently lags the
  upgrades** (verified: recent columns like `share_page_mode`, `hide_title`,
  `subfolder_per_submission`, `multibox_own_folders`, `public_files`, `allow_empty_submission` are
  **absent** from init). See `TECHNICAL-DEBT.md` #9.
- **Applied in prod?** — Best-available knowledge; confirm all with Sean.
- **Safe to rerun?** — Additive `... if not exists` and `drop view … / create view …` are idempotent.

| # | File | Purpose | Key dependency | In init? | Applied in prod? | Safe to rerun? | Notes |
|--|--|--|--|--|--|--|--|
| — | `20260527000000_init.sql` | Base schema (profiles, storage_connections, upload_links, uploads, public view) | — | — | Yes (base) — confirm | Caution (base) | Lags upgrades; do not rerun on a live DB |
| 01 | `01_provider_agnostic_refactor.sql` | Generalize storage to provider-agnostic | init | No | Likely — confirm | Yes | |
| 02 | `02_ensure_grants.sql` | Grants on public view/roles | 01 | No | Likely — confirm | Yes | |
| 03 | `03_account_logo.sql` | `profiles.logo_url` | init | No | Likely — confirm | Yes | |
| 04 | `04_webhooks.sql` | `upload_links.webhook_url` / `webhook_secret` | init | No | Likely — confirm | Yes | |
| 05 | `05_custom_fields.sql` | `upload_links.custom_fields` (+ view) | init | No | Likely — confirm | Yes | |
| 06 | `06_naming_and_notifications.sql` | filename template + notify flags + rules | 05 | No | Likely — confirm | Yes | |
| 07 | `07_youtube.sql` | YouTube provider support | 01 | No | Likely — confirm | Yes | Feature now flag-gated |
| 08 | `08_success_screen.sql` | success message + redirect (+ view) | 05 | No | Likely — confirm | Yes | |
| 09 | `09_batches.sql` | `uploads.batch_id` / `batch_size` / notified | init | No | Likely — confirm | Yes | |
| 10 | `10_select_fields.sql` | select field type support (+ view) | 05 | No | Likely — confirm | Yes | |
| 11 | `11_notifications_v2.sql` | `notification_deliveries` + destinations | 06 | No | Likely — confirm | Yes | |
| 12 | `12_quo_destination.sql` | Quo (OpenPhone) SMS destination | 11 | No | Likely — confirm | Yes | |
| 13 | `13_signup_notify.sql` | admin new-signup notification | init | No | Likely — confirm | Yes | |
| 14 | `14_slack_bot.sql` | Slack bot connection | 11 | No | Likely — confirm | Yes | |
| 15 | `15_link_password.sql` | `upload_links.upload_password` (+ view flag) | init | No | Likely — confirm | Yes | |
| 16 | `16_projects.sql` | projects | init | No | Likely — confirm | Yes | |
| 17 | `17_tags.sql` | tags | init | No | Likely — confirm | Yes | |
| 18 | `18_airtable.sql` | `airtable_config` + Airtable connections | init | No | Likely — confirm | Yes | |
| 19 | `19_submissions.sql` | `submissions` table + `uploads.submission_id` | init | No | Likely — confirm | Yes | First-class submission object |
| 20 | `20_conditional_fields.sql` | `showWhen` projection in public view | 05,19 | No | Likely — confirm | Yes | |
| 21 | `21_form_only.sql` | `destination_type` (drive/youtube/form) + nullable storage/folder (+ view) | 01 | No | Likely — confirm | Yes | |
| 22 | `22_multi_box.sql` | `upload_boxes` (+ view) | 21 | No | Likely — confirm | Yes | |
| 23 | `23_content_blocks.sql` | `content_blocks` (+ view) | 05 | No | Likely — confirm | Yes | |
| 24 | `24_airtable_record_id.sql` | `uploads.airtable_record_id` | 18,19 | No | Likely — confirm | Yes | |
| 25 | `25_sections.sql` | form `sections` (+ view) | 23 | No | Likely — confirm | Yes | |
| 26 | `26_box_sections.sql` | box `sectionId` in view | 22,25 | No | Likely — confirm | Yes | |
| 27 | `27_record_sources.sql` | `uploads.source_record_ids` | 18,19 | No | Likely — confirm | Yes | Connected Data writeback |
| 28 | `28_empty_submission.sql` | `allow_empty_submission` + rebuild view | 21 | No | Provided to Sean — confirm | Yes | Given as copy/paste SQL |
| 29 | `29_public_files.sql` | `public_files` | 18 | No | Provided to Sean — confirm | Yes | |
| 30 | `30_share_page.sql` | `share_page_mode` | 19 | No | Provided to Sean — confirm | Yes | Public share page |
| 31 | `31_hide_title.sql` | `hide_title` + rebuild view | 28 | No | Provided to Sean — confirm | Yes | |
| 32 | `32_private_internal_note.sql` | drop `description` from public view | 31 | No | Provided to Sean — confirm | Yes | View-only change |
| 33 | `33_option_style.sql` | `optionStyle` in view (single-select buttons) | 31 | No | Provided to Sean — confirm | Yes | |
| 34 | `34_submission_folders.sql` | `subfolder_*` cols + `submissions.drive_subfolder_id` | 19 | No | **Pending — assume NOT applied** | Yes | Batch 12; required for dynamic folders |
| 35 | `35_multibox_folders.sql` | `multibox_own_folders` + `submissions.drive_box_folders` | 22,34 | No | **Pending — assume NOT applied** | Yes | Batch 12; required for multi-box folders |

## Deploy guidance
- Run **any not-yet-applied migrations in order** before (or with) deploying the archive that needs
  them. **34 → 35** almost certainly still need to run.
- Migrations that rebuild `upload_links_public` (28, 31, 32, 33) each redefine the whole view; run
  them in order so the final view is correct. (Migrations 34 & 35 do **not** change the view.)
- Combined copy/paste SQL for pending migrations should be provided to Sean at deploy time (this was
  the established workflow).

## Reconciliation TODO (future, not this pass)
- Regenerate `20260527000000_init.sql` from the live schema (or add an "apply all upgrades" runner)
  so fresh environments don't depend on replaying 35 files. Then keep init updated per `AGENTS.md`.
