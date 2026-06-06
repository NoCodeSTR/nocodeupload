# Slack setup for NoCode Upload

One-time setup (~10 minutes) so owners can route upload notifications to a Slack
channel. You'll end up with two env vars: `SLACK_CLIENT_ID` and
`SLACK_CLIENT_SECRET`.

We use a **bot-token** OAuth flow: when an owner connects Slack once, we store
the workspace bot token (encrypted). They then pick any channel — and an
optional person to @mention — from dropdowns, and add as many channel
destinations as they like without reconnecting. Messages post via
chat.postMessage; we auto-join public channels the bot isn't in yet.

## Step 1 — Create the Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**.
2. Name it `NoCode Upload`, pick your workspace, **Create App**.

## Step 2 — Add the OAuth redirect URL + bot scopes

1. Open **Features → OAuth & Permissions**.
2. Under **Redirect URLs**, **Add New Redirect URL** and enter exactly:
   - `https://www.nocodeupload.com/api/slack/callback`
   - (It must match `NEXT_PUBLIC_APP_URL` + `/api/slack/callback`. Use whatever
     canonical host you deploy on — include `www` if that's your canonical
     domain.)
3. Under **Scopes → Bot Token Scopes**, add these five:
   - `chat:write` — post messages
   - `channels:read` and `groups:read` — list public + private channels for the picker
   - `users:read` — list people for the @mention picker
   - `channels:join` — auto-join public channels so posting just works
4. **Save**.

## Step 4 — Grab the credentials

1. Open **Settings → Basic Information → App Credentials**.
2. Copy **Client ID** → `SLACK_CLIENT_ID`.
3. Copy **Client Secret** → `SLACK_CLIENT_SECRET`.
4. Add both to `.env.local` (and to Vercel for production), then redeploy.

## Step 5 — Connect, then add channels

1. In NoCode Upload, go to **Settings → Notifications**. "Connect Slack" is now
   enabled.
2. Click it, **Allow** in Slack. You return with the workspace connected.
3. Click **Add Slack channel** → pick a **channel** and (optionally) a **person
   to @mention** from the dropdowns, then **Add**. Repeat for as many channels
   as you want — no reconnect needed.
4. On any upload link, add a **Routing rule** that notifies that Slack
   destination — e.g. *When `Status` is `Maintenance needed` → #maintenance,
   @Mike*. Add a custom **Message** on the rule to control the exact wording.

## How messages look

Each completed upload (or bundled batch) posts to the chosen channel via
chat.postMessage: your custom message (if set) or a default summary with the
uploader's details, plus an **Open** button / file links to the Drive file or
YouTube video. If you picked a person, they're @mentioned so they get a real
ping.

## Notes & limits

- **Distribution:** for your own workspace you can use the app immediately. To
  let *other* workspaces connect (public SaaS), enable **Manage Distribution →
  Activate Public Distribution**.
- **Connect once, many channels:** one connection = one workspace bot token;
  add as many channel destinations as you like from it.
- **Private channels:** the bot auto-joins *public* channels. For a private
  channel, invite the app to it once (`/invite @NoCodeUpload`).
- **Reconnect** if a channel attempt fails after the bot is removed — the
  delivery log shows the reason.
- Slack delivery is best-effort and never blocks or fails an upload.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Slack (not configured)" is disabled | Env vars unset | Set `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET`, redeploy. |
| `bad_redirect_uri` on connect | Redirect URL mismatch | The Slack app's Redirect URL must equal `NEXT_PUBLIC_APP_URL` + `/api/slack/callback` exactly. |
| `invalid_scope` on connect | Bot scopes missing | Add the five bot scopes in Step 2, then reconnect. |
| Channel dropdown is empty | Token lacks `channels:read`/`groups:read` | Add the scopes and reconnect. |
| Slack attempt "failed: not_in_channel" on a private channel | Bot not invited | `/invite @NoCodeUpload` in that channel. |
