# Slack setup for NoCode Upload

One-time setup (~10 minutes) so owners can route upload notifications to a Slack
channel. You'll end up with two env vars: `SLACK_CLIENT_ID` and
`SLACK_CLIENT_SECRET`.

We use the **incoming-webhook** OAuth flow: when an owner connects Slack, Slack
shows them a channel picker and hands us a webhook URL bound to that channel. We
store it encrypted and POST messages to it — no bot tokens to manage.

## Step 1 — Create the Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**.
2. Name it `NoCode Upload`, pick your workspace, **Create App**.

## Step 2 — Enable Incoming Webhooks

1. In the app, open **Features → Incoming Webhooks**.
2. Toggle **Activate Incoming Webhooks** on.

## Step 3 — Add the OAuth redirect URL

1. Open **Features → OAuth & Permissions**.
2. Under **Redirect URLs**, click **Add New Redirect URL** and enter exactly:
   - `https://www.nocodeupload.com/api/slack/callback`
   - (It must match `NEXT_PUBLIC_APP_URL` + `/api/slack/callback`. Use whatever
     canonical host you deploy on — include `www` if that's your canonical
     domain.)
3. **Save URLs**.

> The `incoming-webhook` scope is added automatically by the install flow, so
> you don't need to set bot scopes manually. (If asked, `incoming-webhook` is
> the only scope required.)

## Step 4 — Grab the credentials

1. Open **Settings → Basic Information → App Credentials**.
2. Copy **Client ID** → `SLACK_CLIENT_ID`.
3. Copy **Client Secret** → `SLACK_CLIENT_SECRET`.
4. Add both to `.env.local` (and to Vercel for production), then redeploy.

## Step 5 — Connect a channel

1. In NoCode Upload, go to **Settings → Notifications**. "Connect Slack" is now
   enabled.
2. Click it, pick a channel in Slack, **Allow**. You'll return to Settings with
   the channel listed as a destination.
3. On any upload link, add a **Routing rule** that notifies that Slack
   destination — e.g. *When `Status` is `Maintenance needed` → #maintenance*.

## How messages look

Each completed upload (or bundled batch) posts a Block Kit message: a header
with the link name, the uploader's details and your custom fields, and an
**Open** button (or file links for a batch) pointing at the Drive file or
YouTube video.

## Notes & limits

- **Distribution:** for your own workspace you can use the app immediately. To
  let *other* workspaces connect (public SaaS), enable **Manage Distribution →
  Activate Public Distribution** (no Slack review needed for incoming-webhook,
  but "Add to Slack" directory listing is optional and reviewed).
- **One channel per connection:** each connect binds one channel. To post to
  another channel, connect again (it appears as a second destination).
- **Reconnect** if a channel is archived or the webhook is revoked — the
  delivery log will show a failed/skipped Slack attempt with the reason.
- Slack delivery is best-effort and never blocks or fails an upload.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Connect Slack (not configured)" is disabled | Env vars unset | Set `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET`, redeploy. |
| `bad_redirect_uri` on connect | Redirect URL mismatch | The Slack app's Redirect URL must equal `NEXT_PUBLIC_APP_URL` + `/api/slack/callback` exactly. |
| "Invalid state" on return | Cookie lost / stale link | Start the connect again from Settings. |
| Slack attempt shows "failed" in Recent notifications | Channel archived / webhook revoked | Reconnect Slack in Settings. |
