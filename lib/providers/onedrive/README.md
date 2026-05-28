# OneDrive provider (roadmap)

Not implemented yet. Mirror the Google adapter layout:

```
lib/providers/onedrive/
├── oauth.ts      — Microsoft identity platform OAuth
├── storage.ts    — Microsoft Graph drive upload session
└── index.ts      — exports a ProviderAdapter
```

Then register in `lib/providers/registry.ts` and flip the status in `PROVIDER_INFO.onedrive`.

Notes specific to OneDrive:
- Use Microsoft Graph: `POST /me/drive/items/{folder-id}:/{filename}:/createUploadSession`.
- Upload chunks via PUT to the returned `uploadUrl`.
- Tenant routing matters for business accounts — store `tenant_id` and
  `drive_id` in `provider_metadata`.
- Personal vs Work/School accounts use different consent endpoints; the
  unified `common` tenant works for both.
