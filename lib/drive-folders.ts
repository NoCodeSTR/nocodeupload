/**
 * Dynamic Drive folder resolution for submissions.
 *
 * Phase 1: each submission gets its own subfolder inside the link's master
 * folder. The folder is created once and cached on submissions.drive_subfolder_id
 * (atomic first-file-wins) so every file in a batch shares one folder.
 *
 * Phase 2: the parent can be a PER-PROPERTY folder resolved from a connected
 * Airtable record — read the folder id from an Airtable field; if empty, create
 * the folder inside the master and write its id back to that field. All folders
 * are app-created, so the least-privilege drive.file scope is sufficient.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createFolder } from "@/lib/providers/google/drive";
import { writeAirtableField } from "@/lib/airtable/record-prefill";

// A Drive file/folder id is a longish opaque token. Cheap sanity check before
// trusting a value pulled from an Airtable field as a parent folder.
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;
const PENDING_PREFIX = "pending:";

/** Make an arbitrary rendered string safe + sensible as a Drive folder name. */
export function sanitizeFolderName(name: string, fallback: string): string {
  const clean = (name || "")
    .replace(/[\\/]+/g, "-") // slashes would imply nesting
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return clean || fallback;
}

/**
 * Resolve the PER-PROPERTY parent folder (Phase 2). Returns the existing folder
 * id from Airtable when present + valid; otherwise creates one inside the master
 * folder and writes its id back to the property record. Falls back to the master
 * folder id if creation fails, so an upload never hard-fails.
 */
export async function resolvePropertyFolder(args: {
  accessToken: string;
  masterFolderId: string;
  existingFolderId: string | null;
  folderName: string;
  // Write-back target (the connected property record):
  userId: string;
  baseId: string;
  propertyTableId: string | null;
  propertyRecordId: string | null;
  folderIdField: string;
}): Promise<string> {
  const existing = (args.existingFolderId ?? "").trim();
  if (DRIVE_ID_RE.test(existing)) return existing;
  try {
    const folder = await createFolder({
      accessToken: args.accessToken,
      name: sanitizeFolderName(args.folderName, "Property"),
      parentId: args.masterFolderId,
    });
    if (args.propertyTableId && args.propertyRecordId) {
      await writeAirtableField({
        userId: args.userId,
        baseId: args.baseId,
        tableId: args.propertyTableId,
        recordId: args.propertyRecordId,
        field: args.folderIdField,
        value: folder.id,
      });
    }
    return folder.id;
  } catch {
    return args.masterFolderId; // fail open — land in the master rather than error
  }
}

/**
 * Find-or-create the submission's own subfolder inside `parentFolderId`, caching
 * it on submissions.drive_subfolder_id so all files in the batch share one
 * folder. Atomic: the first caller claims the row and creates the folder; any
 * concurrent caller polls for the created id. Falls back to the parent folder.
 */
export async function claimSubmissionSubfolder(args: {
  submissionId: string;
  parentFolderId: string;
  accessToken: string;
  name: string;
}): Promise<string> {
  const admin = getSupabaseAdmin();

  const read = async (): Promise<string | null> => {
    const { data } = await admin
      .from("submissions")
      .select("drive_subfolder_id")
      .eq("id", args.submissionId)
      .maybeSingle();
    return (data as { drive_subfolder_id: string | null } | null)?.drive_subfolder_id ?? null;
  };

  const existing = await read();
  if (existing && !existing.startsWith(PENDING_PREFIX)) return existing;

  // Claim: only the caller that flips it from NULL wins the create.
  const { data: claimed } = await admin
    .from("submissions")
    .update({ drive_subfolder_id: `${PENDING_PREFIX}${Date.now()}` } as never)
    .eq("id", args.submissionId)
    .is("drive_subfolder_id", null)
    .select("id");

  if ((claimed?.length ?? 0) > 0) {
    try {
      const folder = await createFolder({
        accessToken: args.accessToken,
        name: sanitizeFolderName(args.name, "Submission"),
        parentId: args.parentFolderId,
      });
      await admin
        .from("submissions")
        .update({ drive_subfolder_id: folder.id } as never)
        .eq("id", args.submissionId);
      return folder.id;
    } catch {
      // Release the claim so a later file can retry, and land in the parent now.
      await admin
        .from("submissions")
        .update({ drive_subfolder_id: null } as never)
        .eq("id", args.submissionId);
      return args.parentFolderId;
    }
  }

  // Lost the race — another file is creating it. Poll briefly for the real id.
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const id = await read();
    if (id && !id.startsWith(PENDING_PREFIX)) return id;
  }
  return args.parentFolderId; // fall back rather than block the upload
}

/**
 * Find-or-create a per-box folder for a submission, cached on
 * submissions.drive_box_folders ({ boxId: folderId }). Used by multi-box links:
 *   - Model B: the box's subfolder INSIDE the shared per-submission folder (name
 *     = box label);
 *   - Model C: the per-submission subfolder inside the box's OWN folder (name =
 *     the submission template).
 * Files upload sequentially, so read-merge-write is race-free in practice; a
 * lost race just lands the file in the parent. Never throws.
 */
export async function claimBoxSubfolder(args: {
  submissionId: string;
  boxId: string;
  parentFolderId: string;
  accessToken: string;
  name: string;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  try {
    const { data } = await admin
      .from("submissions")
      .select("drive_box_folders")
      .eq("id", args.submissionId)
      .maybeSingle();
    const map =
      (data as { drive_box_folders: Record<string, string> | null } | null)?.drive_box_folders ?? {};
    const cur = map[args.boxId];
    if (cur) return cur;

    const folder = await createFolder({
      accessToken: args.accessToken,
      name: sanitizeFolderName(args.name, "Box"),
      parentId: args.parentFolderId,
    });
    await admin
      .from("submissions")
      .update({ drive_box_folders: { ...map, [args.boxId]: folder.id } } as never)
      .eq("id", args.submissionId);
    return folder.id;
  } catch {
    return args.parentFolderId;
  }
}
