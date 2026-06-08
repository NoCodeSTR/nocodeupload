# Airtable setup

NoCode Upload can create a **record in an Airtable table** on every upload —
alongside (not instead of) the file landing in your Google Drive / YouTube.
Each record can carry the file link, the uploader's answers, constant values you
choose, and (optionally) the file itself as an attachment.

There is **no environment variable** to set — Airtable is connected per-account
with a Personal Access Token (PAT) that you create and paste into Settings. The
token is stored encrypted (AES-256-GCM), the same way Google tokens are.

## 1. Create a Personal Access Token

1. Go to **https://airtable.com/create/tokens**.
2. Click **Create token**, give it a name (e.g. "NoCode Upload").
3. Add these **scopes**:
   - `data.records:write` — create rows (and attach files by URL).
   - `schema.bases:read` — let the link form list your bases, tables, and fields.
4. Under **Access**, add the base(s) you want uploads to write into.
5. Create the token and copy it (it starts with `pat…`). You won't see it again.

## 2. Connect it in NoCode Upload

1. Open **Settings → Airtable**.
2. Paste the token and click **Connect**. We validate it immediately (a bad or
   under-scoped token is rejected on the spot).

## 3. Turn it on for a link

In a link's editor, open the **Airtable** section and:

1. Tick **Create an Airtable record on every upload**.
2. Pick the **Base** and **Table** (loaded live from your account).
3. Choose **Per file** or **Per submission**:
   - **Per file** — one row per uploaded file.
   - **Per submission** — one row even when several files are sent at once
     (the file-link and file-name fields list all of them).
4. **Map upload data → fields**: for each piece of upload data (file link, file
   name, uploader name/email, message, date, your custom fields, …) choose the
   Airtable field to write it into. Only the rows you map are written.
5. **Constant values** (optional): set fixed `field = value` pairs on every row
   (e.g. `Source = Guest upload`).
6. **Attachments** (optional, Google Drive only): tick to also copy the file(s)
   into an Airtable attachment field — see the note below.

Records are created automatically once an upload finishes. You can see each
attempt (sent / failed / skipped) in the link's delivery log, under the
`airtable` channel.

## Notes on field types

- We send values as plain text and let Airtable **typecast** them, so text,
  number, currency, single/multi-select, and date fields all just work.
- **Computed fields** (formulas, rollups, lookups, autonumber, created/modified
  time, etc.) can't be written to — they're hidden from the mapping dropdowns.
- **Single/multi-select**: typecast will create the option if it doesn't exist
  yet (so your select options stay in sync with what uploaders pick).

## Notes on attachments

Attachments are **off by default** — link mode just stores the file's URL, which
costs nothing and works for files of any size.

When you enable attachments:

1. We briefly grant an *anyone-with-the-link* view permission on each Drive file.
2. We hand Airtable the file's download URL; Airtable copies the bytes into the
   attachment field (the bytes go **Google → Airtable**, not through our servers).
3. Once Airtable has ingested the file, we **revoke** the temporary share.

Because of this flow:

- Attachments work for **Google Drive** uploads only (YouTube links are stored
  as links).
- Best for **photos and smaller files**. For large videos, leave attachments off
  and rely on the file link — Google's download endpoint shows an interstitial
  for very large files, and Airtable enforces its own attachment size limits.
- The temporary share exists only for the few seconds Airtable needs to fetch
  the file.
