# Dropbox provider (roadmap)

Not implemented yet. When this lights up, mirror the Google adapter layout:

```
lib/providers/dropbox/
├── oauth.ts      — Dropbox OAuth (PKCE flow)
├── storage.ts    — Upload via /2/files/upload_session/* (resumable for big files)
└── index.ts      — exports a ProviderAdapter
```

Then:
1. Register the adapter in `lib/providers/registry.ts` (`getAdapter()`).
2. Flip `PROVIDER_INFO.dropbox.status` from `"coming_soon"` to `"available"`.
3. The Settings UI will pick it up automatically.

Notes specific to Dropbox:
- Dropbox uses **paths** not folder IDs. Store the path as `folder_id` and
  document it in `provider_metadata` (e.g. `{ "path_display": "/Guest Videos" }`).
- For files over 150 MB, use `/2/files/upload_session/start` →
  `/2/files/upload_session/append_v2` → `/2/files/upload_session/finish`.
- Access tokens expire after 4 hours; refresh tokens are long-lived.
