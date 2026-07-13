# NoCode Upload — Roadmap

Prioritized by the product strategy in [`VISION.md`](./VISION.md): depth-first for STR, and every
item should make a downstream **action** easier. Production/deploy state is **⚠️ confirm with Sean**
(see `HANDOFF.md`).

## Live now (deployed & production-tested — confirm exact set with Sean)
Core value is live: Supabase auth · Google Drive connect + Picker · server-relayed uploads ·
custom fields / sections / content blocks · conditional fields · prefills & hidden fields ·
Connected Airtable tables (source) · merge tags · Preview Records · Airtable **create & update**
records (update confirmed working in prod) · existing-record preload · destination-oriented mapping
· attachments · submissions inbox + detail · delivery logs · retry · email / Slack / Quo / webhook ·
dynamic recipients · smart file naming · projects · tags · search · embeds · QR · duplication ·
branding · success screens + validated redirects · form-only submissions.

## Built, awaiting deployment
Package: **`nocodeupload-batch13.tar.gz`** (this handoff). Assume the following ship together:
- **Dynamic submission folders** (single-Drive) — **requires migration 34**.
- **Per-property folders** (Airtable-driven, app-created + write-back) — **migration 34**.
- **Multi-box folders** (Model B default / Model C opt-in) — **requires migration 35**.
- **Public share pages `/s/[token]`** — **requires migration 30** (if not already applied).
- **Hide form title** — **requires migration 31** (if not already applied).
- **Private internal note** (description no longer public) — **migration 32**.
- **Single-select "buttons" display** — **migration 33**.
- **YouTube feature flag OFF** + strengthened privacy Limited-Use language (Batch 13, no migration).

> Confirm with Sean which of 28–33 are already applied; **34 & 35 are almost certainly pending.**

## Required launch tasks (not features)
- [ ] **Google OAuth verification** — consent screen (Drive scope only), submit, respond to review.
- [ ] **Demo video** for verification (screen recording of consent + a real upload landing in Drive).
- [ ] **Search Console** domain verification for the canonical host.
- [ ] **Privacy / terms** confirmation (privacy already has the Limited-Use disclosure; keep the
      consent-screen link pointing at the canonical host).
- [ ] **Canonical host decision** (www vs apex) made consistent across DNS + env + Google redirect URI.
- [ ] **Production smoke testing** — run [`SMOKE-TESTS.md`](./SMOKE-TESTS.md) after each deploy.
- [ ] **Support email** confirmation (`support@nocodeupload.com`) is monitored.
- [ ] **Billing decision** (see VISION/DECISIONS — submission-based direction).
- [ ] **Monitoring & alerts** — error tracking + a delivery-failure alert (none today).

## Near-term product roadmap (prioritized)
1. **STR templates** — pre-wired flows (cleaner report, damage report, maintenance, owner
   walkthrough) so a host is live in minutes. Highest time-to-value lever.
2. **Better full-form preview** — see the whole public form (not just personalization) in the builder.
3. **Saved templates** — owners save/reuse their own link configs.
4. **Billing** — meter submissions; integrate a provider.
5. **Submission lifecycle / status** — triage states (new / in-progress / resolved) in the inbox.
6. **Two-way Airtable status sync** — reflect submission status back to the record.
7. **Dynamic connected-record picker for public users** — let the uploader pick which record a
   submission is for (when not pre-linked via URL).
8. **Public submission portals** — a branded page where a recipient sees their submissions.
9. **Bulk link generation** — generate many per-property links at once.
10. **Team permissions** — multiple users per account with roles.
11. **Usage analytics** — submissions over time, per link/property.
12. **Retry & observability enhancements** — auto-retry with backoff; delivery dashboards; alerts.

## Later expansion
- **Dropbox / Box / OneDrive** provider adapters (stubs exist).
- **Cloudflare (or R2) upload relay** to cut Vercel bandwidth on large files.
- **AI summaries** of submissions; **AI video descriptions**; **document extraction** (parse
  uploaded docs into fields).
- **Broader vertical templates** (property mgmt, real estate, maintenance, events, construction,
  insurance, education, client intake, field services, media collection).

## Explicitly deferred (and why)
- **YouTube uploads** — deferred behind `YOUTUBE_ENABLED=false` until the **YouTube API Services
  audit + quota extension** are approved (default ~6 uploads/day; unaudited projects force videos
  private). The public-files toggle + share page already give shareable video links without
  YouTube's ceiling.
- **Broader Drive scopes** (`drive`/`drive.readonly`) — deferred indefinitely; would trigger CASA.
- **Regenerating the canonical init schema** to include upgrades 01–35 — deferred (risky to hand-
  merge; documented as debt). Fresh DBs apply init + all upgrades in order for now.
- **Restoring browser-direct uploads** — deferred; only with explicit approval.
