/**
 * Airtable REST API client (server-only).
 *
 * Auth: a Personal Access Token (PAT), sent as `Authorization: Bearer <pat>`.
 * The owner creates the PAT at https://airtable.com/create/tokens with these
 * scopes:
 *   - data.records:write   (create records, attach files by URL)
 *   - schema.bases:read    (list bases + tables/fields for the picker)
 * and grants it access to the base(s) they want to use.
 *
 * Endpoints used:
 *   GET  /v0/meta/whoami                         validate the token
 *   GET  /v0/meta/bases                          list bases (paginated)
 *   GET  /v0/meta/bases/{baseId}/tables          list tables + fields
 *   POST /v0/{baseId}/{tableId}                  create a record (typecast)
 *   GET  /v0/{baseId}/{tableId}/{recordId}       read a record (attach poll)
 *
 * All calls are best-effort wrappers that surface a useful message on failure;
 * the record-creation layer turns thrown errors into a logged "failed" delivery.
 */
import "server-only";

const API_BASE = "https://api.airtable.com/v0";

// Fail fast rather than hang. Record creation now runs BEFORE notifications in
// the upload pipeline, so a stuck Airtable call must never block the webhook/
// email/SMS fan-out — it surfaces as a logged "failed" delivery instead.
const REQUEST_TIMEOUT_MS = 15_000;

interface AirtableError {
  error?: { type?: string; message?: string } | string;
}

function errMessage(status: number, body: AirtableError | null): string {
  const e = body?.error;
  if (typeof e === "string") return `${status}: ${e}`;
  if (e?.message) return `${status}: ${e.message}`;
  if (e?.type) return `${status}: ${e.type}`;
  return `Airtable responded ${status}`;
}

async function airtableFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Airtable request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let body: AirtableError | null = null;
    try {
      body = (await res.json()) as AirtableError;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(errMessage(res.status, body));
  }
  return (await res.json()) as T;
}

// --- Token validation --------------------------------------------------------

export interface AirtableWhoami {
  id: string;
  email?: string;
}

/** Validate a PAT. Throws if the token is invalid or lacks basic access. */
export async function airtableWhoami(token: string): Promise<AirtableWhoami> {
  return airtableFetch<AirtableWhoami>(token, "/meta/whoami");
}

// --- Metadata (bases + tables) -----------------------------------------------

export interface AirtableBase {
  id: string;
  name: string;
  permissionLevel?: string;
}

/** List the bases the token can see. Follows pagination (rarely more than one page). */
export async function listBases(token: string): Promise<AirtableBase[]> {
  const out: AirtableBase[] = [];
  let offset: string | undefined;
  do {
    const qs = offset ? `?offset=${encodeURIComponent(offset)}` : "";
    const data = await airtableFetch<{ bases?: AirtableBase[]; offset?: string }>(
      token,
      `/meta/bases${qs}`,
    );
    for (const b of data.bases ?? []) out.push({ id: b.id, name: b.name, permissionLevel: b.permissionLevel });
    offset = data.offset;
  } while (offset && out.length < 1000);
  return out;
}

export interface AirtableField {
  id: string;
  name: string;
  type: string;
  /** Choice names for singleSelect / multipleSelects (for field import). */
  options?: string[];
}

export interface AirtableTable {
  id: string;
  name: string;
  fields: AirtableField[];
}

/** List tables (with their fields) in a base. */
export async function listTables(token: string, baseId: string): Promise<AirtableTable[]> {
  const data = await airtableFetch<{
    tables?: Array<{
      id: string;
      name: string;
      fields?: Array<{
        id: string;
        name: string;
        type: string;
        options?: { choices?: Array<{ name?: string }> };
      }>;
    }>;
  }>(token, `/meta/bases/${encodeURIComponent(baseId)}/tables`);
  return (data.tables ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    fields: (t.fields ?? []).map((f) => {
      const choices = f.options?.choices;
      const opts = Array.isArray(choices)
        ? choices.map((c) => c.name).filter((n): n is string => Boolean(n))
        : undefined;
      return { id: f.id, name: f.name, type: f.type, ...(opts && opts.length ? { options: opts } : {}) };
    }),
  }));
}

// --- Records -----------------------------------------------------------------

export type AirtableFieldValue =
  | string
  | number
  | boolean
  // Linked-record fields take an array of record ids (["recXXX"]); multi-selects
  // take an array of option strings. Typecast tolerates both.
  | string[]
  | Array<{ url: string; filename?: string }>;

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

/**
 * Create one record. `typecast` lets Airtable coerce strings into numbers,
 * dates, single/multi selects, etc., so we can send plain strings for most
 * field types. Attachment fields must be the array-of-{url} shape (typecast
 * does not convert strings to attachments).
 */
export async function createRecord(args: {
  token: string;
  baseId: string;
  tableId: string;
  fields: Record<string, AirtableFieldValue>;
}): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(
    args.token,
    `/${encodeURIComponent(args.baseId)}/${encodeURIComponent(args.tableId)}`,
    {
      method: "POST",
      body: JSON.stringify({ fields: args.fields, typecast: true }),
    },
  );
}

/**
 * Update (PATCH) one record — only the provided fields change; others are left
 * intact. Used for two-way sync (submission updates an existing record).
 */
export async function updateRecord(args: {
  token: string;
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, AirtableFieldValue>;
}): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(
    args.token,
    `/${encodeURIComponent(args.baseId)}/${encodeURIComponent(args.tableId)}/${encodeURIComponent(args.recordId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields: args.fields, typecast: true }),
    },
  );
}

/** Read one record (used to confirm attachment ingestion before revoking shares). */
export async function getRecord(args: {
  token: string;
  baseId: string;
  tableId: string;
  recordId: string;
}): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(
    args.token,
    `/${encodeURIComponent(args.baseId)}/${encodeURIComponent(args.tableId)}/${encodeURIComponent(args.recordId)}`,
  );
}
