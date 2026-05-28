# Box provider (roadmap)

Not implemented yet. Mirror the Google adapter layout:

```
lib/providers/box/
├── oauth.ts      — Box OAuth (standard authorization code)
├── storage.ts    — Box chunked upload (preflight check + chunked upload session)
└── index.ts      — exports a ProviderAdapter
```

Then register in `lib/providers/registry.ts` and flip the status in `PROVIDER_INFO.box`.

Notes specific to Box:
- For files ≥ 20 MB, use **chunked upload sessions**:
  POST `/files/upload_sessions` → PUT each part → POST `/commit`.
- For smaller files, use the standard `/files/content` endpoint.
- Enterprise customers may have additional governance constraints (folder
  retention, classification labels). Surface these in `provider_metadata`.
