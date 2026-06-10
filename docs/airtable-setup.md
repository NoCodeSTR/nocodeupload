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
   - `data.records:read` — *(optional)* only needed for **record personalization**
     (`?record=recXXX` URLs that pull a record's columns into the form). Without
     it, everything else works; record prefill simply no-ops.
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

1. For each file we mint a **private, signed, expiring link** to it (default
   30-minute lifetime) that points at our `/api/airtable/file` proxy.
2. We create the record with those links in the attachment field; Airtable
   fetches each file through the proxy, which streams the bytes straight from
   your Drive. **The Drive file is never made public** — the proxy uses your
   own connection to read it, and the link can't be forged or reused after it
   expires.
3. Because every link stays valid while Airtable works, **all files in a
   multi-file submission are reliably attached** (no share/revoke timing race).

Because of this flow:

- Attachments work for **Google Drive** uploads only (YouTube links are stored
  as links).
- To collect several files from one submission into a **single record's
  attachment field**, set the record mode to **Per submission**. Per-file mode
  creates a separate record (and attachment) for each file.
- Files larger than **100 MB** skip the attachment and keep just the link
  (recommended for large videos — Airtable also enforces its own attachment
  size limits).
- The attached bytes pass through our server (unlike link mode). This only
  applies to files you choose to attach.

### Picking the right field type for the file link

In **Per submission** mode, the *File link* and *File name* sources can contain
several values (one per file, newline-separated). An Airtable **URL**, **Email**,
or **Phone** field only holds a single formatted value, so map those sources to a
**Single line text** or **Long text** field instead. The link editor warns you
when a mapping would overflow a single-value field.
