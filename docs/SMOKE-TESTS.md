# NoCode Upload — Production Smoke-Test Checklist

Run after every deploy (and after any migration). Tick each. Note the commit SHA + date at the top
of each run. Items depend on the relevant migrations being applied (see `MIGRATIONS.md`) and, for
folders/share pages, on Batch 12/6 being deployed.

_Run: SHA `__________`  ·  Date `__________`  ·  By `__________`_

## Authentication
- [ ] Signup (email/password)
- [ ] Email confirmation
- [ ] Login
- [ ] Magic link login
- [ ] Logout
- [ ] Protected routes redirect to /login when signed out

## Storage
- [ ] Connect Google Drive (OAuth consent → returns connected)
- [ ] Disconnect, then reconnect
- [ ] Google Picker opens and a folder can be selected
- [ ] Standard single-file upload lands in the chosen Drive folder
- [ ] Mobile camera upload (phone browser)
- [ ] Large video upload (multi-chunk; watch it complete)
- [ ] Multiple files in one submission (batch)
- [ ] Multi-box link routes each box's files correctly
- [ ] Dynamic submission folder created (Batch 12 + migration 34)
- [ ] Per-property folder created + reused; folder id written back to Airtable (migration 34)
- [ ] Multi-box Model B: box-named subfolders inside one clean folder (migration 35)
- [ ] Multi-box Model C: per-clean subfolder inside each box's own folder (migration 35)
- [ ] Browser-close warning appears mid-upload
- [ ] Failure handling: a rejected file shows a clear error; others still upload

## Forms & data
- [ ] Form-only submission (no files) succeeds and appears in the inbox
- [ ] Conditional fields show/hide correctly (field-controlled)
- [ ] Conditional field controlled by a connected Airtable record field
- [ ] Hidden fields captured server-side
- [ ] URL prefills populate fields
- [ ] Connected-table merge tags render on the public form ({{alias.Field}})
- [ ] Preview Records shows real personalization in the builder
- [ ] Imported Airtable fields created + wired for write-back
- [ ] Create Airtable record on submit
- [ ] Update existing Airtable record on submit (delivery log says "Updated record …")
- [ ] Existing values preload in update mode (unmapped columns not blanked)
- [ ] Linked-record mapping (ref:alias) writes a linked field
- [ ] Attachments land in Airtable via the signed proxy
- [ ] Per-file and per-submission Airtable record modes both behave

## Notifications
- [ ] Owner email
- [ ] Custom email destination (routing rule)
- [ ] Slack
- [ ] Quo (SMS)
- [ ] Webhook fires with a valid payload (files[].url present)
- [ ] Dynamic recipient (SMS/email pulled from connected record)
- [ ] Connected-record message tokens render in Slack/SMS
- [ ] Batch notification is a single bundled message
- [ ] Delivery log shows every attempt (incl. for a form-only submission)
- [ ] Retry failed delivery re-runs and logs

## Public experience
- [ ] Public link (/u/[slug]) renders + submits
- [ ] Password-protected link gate works
- [ ] Embed (/embed/[slug]) renders + submits inside an iframe
- [ ] QR code page renders + scans to the link
- [ ] Branding (per-link logo + accent) shows; falls back to account logo
- [ ] Success message renders (with tokens, e.g. {{guest.First Name}})
- [ ] Redirect URL honored only for http(s); javascript:/data: rejected
- [ ] "Powered by NoCodeUpload.com" attribution present
- [ ] Deactivated / expired link shows the unavailable state
- [ ] Public share page (/s/[token]) renders per setting (Off / Files only / Files + answers) — migration 30
- [ ] Hide-title: link name heading hidden on the public form when enabled (migration 31)
- [ ] Private internal note: `description` never appears on the public form (migration 32)

## Security
- [ ] Unauthorized dashboard access blocked (signed-out → /login)
- [ ] Cross-tenant record access blocked (user A cannot see user B's links/submissions/uploads)
- [ ] Invalid/internal webhook URL rejected (SSRF guard)
- [ ] Invalid redirect URL rejected
- [ ] Rate limit triggers on abusive volume (per IP-hash / per link)
- [ ] Public view leaks nothing sensitive: no folder id, storage connection, owner id, provider, or
      the private internal note
- [ ] YouTube connect blocked while `YOUTUBE_ENABLED=false` (destination hidden, `/api/google/connect?target=youtube` bounces to Settings, Settings shows "Coming soon") — Batch 13
