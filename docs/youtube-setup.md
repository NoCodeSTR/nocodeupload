# YouTube as an upload destination — setup & approval

NoCode Upload can send uploaded **videos** straight to a connected YouTube
channel as **unlisted**, with a title and description built from the upload's
details (uploader name, message, custom fields, date). The result is a
`youtube.com/watch?v=…` URL that flows into your webhook and notification email
so you can wire up Slack / Quo / Make.

This rides on the **same Google Cloud project and OAuth client** you already set
up for Drive (see `google-cloud-setup.md`). There are **no new environment
variables** — YouTube reuses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
`GOOGLE_REDIRECT_URI`. You only add an API and a scope.

> ⚠️ **Read "Step 4 — The compliance audit" before you demo this.** Until your
> project passes YouTube's audit, Google **forces every API-uploaded video to
> `private`** regardless of the `unlisted` setting we request. This is expected
> and is a YouTube policy, not a bug. Start the audit early — it's the long pole.

---

## Step 1 — Enable the YouTube Data API v3

With your existing `NoCode Upload` project selected:

- Open https://console.cloud.google.com/apis/library/youtube.googleapis.com
- Click **Enable**.

(The Drive and Picker APIs stay enabled — YouTube is additive.)

## Step 2 — Add the upload scope to the OAuth consent screen

1. Go to https://console.cloud.google.com/apis/credentials/consent.
2. **Edit App** → continue to the **Scopes** step → **Add or Remove Scopes**.
3. In the manual entry box, paste and **Add to table**:
   - `https://www.googleapis.com/auth/youtube.upload`
4. **Update** → **Save and Continue**.

You now have two scopes on the consent screen: `drive.file` (Drive) and
`youtube.upload` (YouTube). NoCode Upload only ever requests **one of them per
connection** — connecting Drive asks for `drive.file`; connecting YouTube asks
for `youtube.upload`. They're never bundled, so a Drive-only user never sees the
YouTube permission and vice-versa.

> **Why `youtube.upload` only?** It's the minimal scope to insert videos. We do
> not request `youtube.readonly` or full `youtube` (manage) — the app only needs
> to create videos, never read or manage the channel.

## Step 3 — Add the test user (Testing mode)

While the app is in **Testing** mode, only listed test users can complete OAuth.
Add the Google account that owns the channel you'll test with under
**Audience → Test users**. No code or env changes needed.

You can now go to **Settings → Connected storage providers → YouTube → Connect**
in the app, grant access, and create a YouTube upload link.

---

## Step 4 — The compliance audit (the important one)

New projects using `youtube.upload` are **unaudited**. Google's policy for
unaudited projects:

- **All videos uploaded via the API are forced to `private`** — even though we
  request `unlisted`. Only the channel owner can see them.
- This is by design and applies to every unaudited project, not just ours.

To get videos to actually publish as **unlisted** (visible to anyone with the
link, as the product intends), you must pass the **YouTube API Services audit**:

1. Make sure your project's OAuth consent screen is complete (app name, logo,
   homepage `https://www.nocodeupload.com`, privacy `…/privacy`, terms `…/terms`).
2. Submit the audit form: **https://support.google.com/youtube/contact/yt_api_form**
   - Describe the use case: *"A SaaS that lets a channel owner collect videos
     from third parties (e.g. short-term-rental guests/cleaners) via a public
     upload link; each video is uploaded to the owner's channel as unlisted with
     an auto-generated title/description. Files are uploaded with the owner's
     own OAuth credentials; we never read or manage their channel."*
   - List the scope: `https://www.googleapis.com/auth/youtube.upload`.
   - They'll usually ask for a screencast of the full flow (connect → create
     link → upload → resulting unlisted video). Record one against a deployed
     URL.
3. This audit is **separate from** standard Google OAuth verification (below).
   You can run both in parallel.

> Until audited: you can still build and demo the whole pipeline — connect,
> create link, upload a video, see it land on the channel, and get the watch URL
> in the webhook/email. The only difference is the video's privacy is `private`
> instead of `unlisted`. Once audited, the `unlisted` setting we send takes
> effect with no code change.

## Step 5 — Quota (plan around it)

The YouTube Data API gives each project a default **10,000 units/day**, and
`videos.insert` costs **~1,600 units**. That's **~6 uploads/day** out of the box.

- Fine for testing and early users.
- For production volume, request a quota increase via the same audit/quota form
  before launch. Approval considers your audit status and use case, so getting
  audited first helps.
- NoCode Upload surfaces YouTube's rejection cleanly if you hit the cap (the
  uploader sees "the destination isn't reachable right now").

---

## Standard OAuth verification (for both Drive and YouTube)

Independent of the YouTube audit, the OAuth app itself needs Google
verification to leave Testing mode (which is capped at 100 users):

- `drive.file` and `youtube.upload` are both **sensitive** (not *restricted*)
  scopes → standard verification, **no CASA security assessment**.
- Requirements: verified domain ownership, a public homepage, a privacy policy
  and terms page (both already built at `/privacy` and `/terms`), an app logo,
  and a demo video of each scope in use.
- Submit from the OAuth consent screen → **Publish app** → **Prepare for
  verification**.

## How it behaves in the product

- **Connection**: Settings shows a **YouTube** card next to Google Drive. One
  Google account can have both a Drive connection and a YouTube connection —
  they're stored as separate `storage_connections` rows with different scopes.
- **Link creation**: when a link points at a YouTube connection, the form hides
  the folder picker, locks file types to **video only**, and shows two template
  fields:
  - **Video title** — e.g. `{name} — {field:Property}`
  - **Video description** — multi-line, supports `{name}`, `{email}`,
    `{message}`, `{date}`, `{time}`, `{original}`, and `{field:Label}`.
- **Upload**: the public page is provider-neutral; the visitor just uploads a
  video. It's relayed to YouTube via the same resumable pipeline as Drive.
- **Result**: the completed upload's **watch URL** (`youtube.com/watch?v=…`)
  appears in the submissions list ("Watch on YouTube"), the notification email
  button, and the webhook payload's `file.url` — point Slack/Quo automations at
  `file.url`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Uploaded video is `private`, not `unlisted` | Project not yet audited | Pass the YouTube audit (Step 4). No code change needed afterward. |
| "The destination isn't reachable right now" on upload | Daily quota exhausted (~6 uploads) or connection needs reconnect | Wait for quota reset or request an increase (Step 5); or reconnect YouTube in Settings. |
| Non-video file rejected | YouTube links are video-only | Expected — use a Drive link for non-video files. |
| YouTube card missing in Settings | `youtube.googleapis.com` not enabled, or Google env vars unset | Enable the API (Step 1); confirm Google client env vars are set. |
