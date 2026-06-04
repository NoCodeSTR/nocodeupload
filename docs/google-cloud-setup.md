# Google Cloud setup for NoCode Upload

This is a one-time setup. Total time: ~15 minutes. You'll end up with five env vars to drop into `.env.local` (and later into Vercel).

## What you're creating

| Thing | What it does | Becomes env var |
|---|---|---|
| GCP project | Container for everything below | (not env var) |
| OAuth client ID + secret | Lets users grant our server permission to upload to their Drive | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
| Picker API key | Lets the in-browser Google Picker load | `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` |
| OAuth consent screen | The "NoCode Upload wants access to…" dialog users see | (not env var) |
| Project number | Required by the Picker SDK | `NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER` |

## Step 1 — Create the project

1. Go to https://console.cloud.google.com/projectcreate.
2. **Project name:** `NoCode Upload`.
3. Leave organization blank (or pick yours if you have one).
4. Click **Create**.
5. After creation, copy the **Project number** from the dashboard home (looks like `123456789012`). Save this — it goes in `NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER`.

## Step 2 — Enable the APIs

Run these two links with your new project selected, then click **Enable** on each:

- https://console.cloud.google.com/apis/library/drive.googleapis.com — Google Drive API
- https://console.cloud.google.com/apis/library/picker.googleapis.com — Google Picker API

## Step 3 — Configure the OAuth consent screen

1. Go to https://console.cloud.google.com/apis/credentials/consent.
2. User type: **External**. Click **Create**.
3. App information:
   - **App name:** `NoCode Upload`
   - **User support email:** your email
   - **App logo:** optional for MVP (recommended later — a public-looking logo speeds up the verification review)
4. App domain:
   - **Application home page:** `https://nocodeupload.com`
   - **Application privacy policy link:** `https://www.nocodeupload.com/privacy`
   - **Application terms of service link:** `https://www.nocodeupload.com/terms`
5. Authorized domains: add `nocodeupload.com`.
6. Developer contact: your email.
7. Click **Save and Continue**.

**Scopes** (next screen):
- Click **Add or Remove Scopes**.
- Paste this in the manual entry box and click **Add to table**:
  - `https://www.googleapis.com/auth/drive.file`
- Then **Update**, then **Save and Continue**.

> **Why only `drive.file`?** It's the least-privilege Drive scope: the app can create/manage files it makes, plus access items the user explicitly picks via the Google Picker. Picking a folder grants per-folder access, so we can upload into it **without** the broad `drive.readonly` scope. `drive.readonly` is *restricted* (triggers Google's annual CASA security assessment at verification), so we deliberately avoid it.

**Test users** (next screen):
- While the app is in "Testing" mode (before Google verification), only listed test users can complete the OAuth flow. Add your own email and any teammates.
- Click **Save and Continue**.

> **Verification:** `drive.file` is a "sensitive" (not restricted) scope. You can ship in Testing mode (capped at 100 users) now. For wider launch, submit for verification — standard process (privacy policy, app homepage, logo, demo video, scope justification); no security assessment since we avoid restricted scopes.

## Step 4 — Create the OAuth 2.0 Client ID

1. Go to https://console.cloud.google.com/apis/credentials.
2. **+ Create Credentials** → **OAuth client ID**.
3. **Application type:** Web application.
4. **Name:** `NoCode Upload Web Client`.
5. **Authorized JavaScript origins** — add both:
   - `http://localhost:3000`
   - `https://nocodeupload.com`
6. **Authorized redirect URIs** — add both:
   - `http://localhost:3000/api/google/callback`
   - `https://nocodeupload.com/api/google/callback`
7. Click **Create**.
8. Copy the **Client ID** → that's `GOOGLE_CLIENT_ID` AND `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same value, server and client both need it).
9. Copy the **Client secret** → that's `GOOGLE_CLIENT_SECRET`.

> Once you have a Vercel preview URL, come back and add it to **Authorized JavaScript origins** (something like `https://nocodeupload-git-main-yourname.vercel.app`). Don't bother adding individual preview deploys — only `main` and the production domain.

## Step 5 — Create the Picker API key

1. Still at https://console.cloud.google.com/apis/credentials.
2. **+ Create Credentials** → **API key**.
3. Copy the key → that's `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`.
4. Click **Edit API key** to restrict it (important — this key is exposed to browsers):
   - **Application restrictions:** HTTP referrers
   - Add:
     - `http://localhost:3000/*`
     - `https://nocodeupload.com/*`
   - **API restrictions:** Restrict key → select **Google Picker API** only.
   - **Save**.

## Step 6 — Drop the values into `.env.local`

Open `.env.local` (copied from `.env.local.example`) and fill in:

```bash
GOOGLE_CLIENT_ID=<the client ID from step 4>
GOOGLE_CLIENT_SECRET=<the client secret from step 4>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback

NEXT_PUBLIC_GOOGLE_CLIENT_ID=<same as GOOGLE_CLIENT_ID>
NEXT_PUBLIC_GOOGLE_PICKER_API_KEY=<the picker API key from step 5>
NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER=<the project number from step 1>
```

## When you ship to production

In Vercel project settings → Environment Variables, set:

```bash
GOOGLE_REDIRECT_URI=https://nocodeupload.com/api/google/callback
NEXT_PUBLIC_APP_URL=https://nocodeupload.com
```

All other Google vars stay the same.

## Troubleshooting

**"Error 400: redirect_uri_mismatch"**
Your `GOOGLE_REDIRECT_URI` env value must match an entry under Authorized redirect URIs *exactly* — including protocol, trailing slash (or lack of), and port. Localhost is `http://`, prod is `https://`.

**"This app isn't verified"**
Expected while the OAuth consent screen is in Testing mode. Test users see a warning and can click "Continue (unsafe)". To remove this for the public, submit the consent screen for verification.

**Picker fails silently in the browser**
Open devtools → Network → look for the `picker.googleapis.com` request. 403 means the API key referrer restriction is rejecting your origin. Add the origin under HTTP referrers on the API key.

**Refresh token isn't returned**
Google only issues a refresh token on the *first* consent for a given user. To force re-issuance during development, revoke access at https://myaccount.google.com/permissions and reconnect. (Our connect URL also sends `prompt=consent` to force this — see `lib/google/oauth.ts`.)
