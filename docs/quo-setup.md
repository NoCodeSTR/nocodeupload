# Quo (OpenPhone) SMS notifications

Let owners get a **text message** when uploads arrive, sent from their own Quo
number. Unlike Slack, there's no app for you to create — each owner connects
their own Quo account by pasting an API key. Nothing for the platform operator
to configure.

## What the owner does (in-app)

1. In Quo, go to **Settings → API** and generate an **API key**. (Requires an
   active subscription and an Owner/Admin role.)
2. In NoCode Upload, go to **Settings → Notifications → Add SMS (Quo)** and
   enter:
   - **API key** — the key from step 1 (stored encrypted; never shown again).
   - **From** — one of their Quo phone numbers, in E.164 form (`+15555550123`).
   - **To** — where the alert text should go (their cell, a teammate), E.164.
3. On any upload link, add a **Routing rule** that notifies the Quo destination
   — e.g. *When `Status` is `Maintenance needed` → text my cell*.

## Requirements & limits (on the owner's Quo account)

- **A2P carrier registration** is required to send to **US numbers** via the
  API. This is done in Quo, not here. Without it, sends are rejected and show as
  "failed" in the Recent notifications panel with Quo's reason.
- **Prepaid API messaging credits** must be available in the Quo workspace.
- The `from` number must belong to that Quo workspace.

## How it works

- Send: `POST https://api.openphone.com/v1/messages` with the API key in the
  `Authorization` header (raw key, not a Bearer token) and body
  `{ content, from, to: ["+1…"] }`.
- Message content is a short one-liner: the link name, file name/type (or file
  count for a batch), the uploader, and the result link (Drive file / YouTube).
- Best-effort and logged: every text shows in the link's **Recent
  notifications** panel as sent / failed / skipped with the reason.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Quo attempt shows "failed: 4xx" | A2P not registered, no credits, or bad `from` | Complete A2P + add credits in Quo; confirm `from` is a Quo number. |
| "Quo credentials unavailable" skip | Stored config incomplete | Remove and re-add the SMS destination in Settings. |
| Nothing arrives but status is "sent" | Carrier filtering / wrong `to` | Verify the `to` number; check Quo's message log. |
