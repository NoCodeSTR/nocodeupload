"use client";

/**
 * FolderPicker — primary "Pick a folder" UI with a manual-paste fallback.
 *
 * Primary path (Google Picker):
 *   1. Lazy-load https://apis.google.com/js/api.js on first click.
 *   2. Load the 'picker' gapi module.
 *   3. POST /api/google/picker-token to mint a fresh access token for
 *      this connection. Token is held in memory for the duration of the
 *      picker session and not persisted anywhere.
 *   4. Build a folder-only picker with two views: "My Drive" + "Shared with me".
 *   5. On selection, fire `onPick({folderId, folderName})`.
 *
 * Fallback path (manual folder ID):
 *   1. User clicks "Paste folder ID manually" toggle.
 *   2. Pastes a Drive folder ID into a text input.
 *   3. POST /api/google/verify-folder to validate against Drive API and
 *      fetch the folder's display name.
 *   4. On success, fire the same `onPick({folderId, folderName})` callback.
 *
 * Why the fallback exists:
 *   - Corporate domains often restrict third-party access to Drive APIs;
 *     the Picker fails to open or shows an error.
 *   - Some ad-blockers block apis.google.com/js/api.js.
 *   - The Picker is a popup; some users have popups blocked by default.
 */
import { useCallback, useState } from "react";
import { Folder, FolderPlus, Check, AlertCircle } from "lucide-react";

// ----- Picker SDK types (loose; we only use a handful of fields) ----------

interface PickerDocsView {
  setSelectFolderEnabled(enabled: boolean): PickerDocsView;
  setIncludeFolders(included: boolean): PickerDocsView;
  setMimeTypes(types: string): PickerDocsView;
  setOwnedByMe(owned: boolean): PickerDocsView;
}

interface PickerBuilder {
  setAppId(appId: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  addView(view: PickerDocsView): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(cb: (data: PickerCallbackData) => void): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}

interface PickerCallbackData {
  action: string;
  docs?: Array<{ id: string; name: string; mimeType: string }>;
}

interface PickerSdk {
  ViewId: { FOLDERS: string };
  Action: { PICKED: string; CANCEL: string; LOADED: string };
  Feature: { MULTISELECT_ENABLED: string; NAV_HIDDEN: string };
  DocsView: new (viewId: string) => PickerDocsView;
  PickerBuilder: new () => PickerBuilder;
}

interface GapiSdk {
  load: (
    module: string,
    cb: { callback: () => void; onerror?: () => void } | (() => void),
  ) => void;
}

declare global {
  interface Window {
    gapi?: GapiSdk;
    google?: { picker: PickerSdk };
  }
}

const GAPI_SCRIPT_SRC = "https://apis.google.com/js/api.js";

let gapiScriptPromise: Promise<void> | null = null;
let pickerModulePromise: Promise<void> | null = null;

/** Ensure both the apis.google.com script and the picker module are loaded. */
async function loadPickerSdk(): Promise<void> {
  if (typeof window === "undefined") return;

  if (!window.gapi) {
    gapiScriptPromise ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GAPI_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error(
            "Couldn't load Google's picker script. An ad blocker or corporate proxy may be blocking apis.google.com.",
          ),
        );
      document.head.appendChild(script);
    });
    await gapiScriptPromise;
  }

  if (!window.google?.picker) {
    pickerModulePromise ??= new Promise((resolve, reject) => {
      window.gapi!.load("picker", {
        callback: () => resolve(),
        onerror: () => reject(new Error("Couldn't load the picker module.")),
      });
    });
    await pickerModulePromise;
  }
}

// ----- Component -----------------------------------------------------------

export interface FolderPickerProps {
  connectionId: string;
  /** Public env values the picker SDK needs (passed in to avoid client-side env reads). */
  config: {
    apiKey: string;
    projectNumber: string;
  };
  /** Fires when the user successfully picks (or pastes) a folder. */
  onPick: (folder: { folderId: string; folderName: string }) => void;
  /** Pre-selected folder, if any — shown in the "Currently selected" pill. */
  initialFolder?: { folderId: string; folderName: string } | null;
}

type Mode = "idle" | "loading" | "error";

export function FolderPicker({
  connectionId,
  config,
  onPick,
  initialFolder,
}: FolderPickerProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const [selected, setSelected] = useState<{ folderId: string; folderName: string } | null>(
    initialFolder ?? null,
  );

  const fireOnPick = useCallback(
    (folder: { folderId: string; folderName: string }) => {
      setSelected(folder);
      onPick(folder);
    },
    [onPick],
  );

  // ---- Primary: open Google Picker ---------------------------------------

  const openPicker = useCallback(async () => {
    setMode("loading");
    setError(null);

    try {
      await loadPickerSdk();

      const tokenRes = await fetch("/api/google/picker-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!tokenRes.ok) {
        const body = (await tokenRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Picker token request failed (${tokenRes.status})`);
      }
      const { accessToken } = (await tokenRes.json()) as { accessToken: string };

      const { google } = window;
      if (!google?.picker) {
        throw new Error("Picker SDK didn't initialize as expected.");
      }

      const myDriveFolders = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes("application/vnd.google-apps.folder");

      const sharedFolders = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setOwnedByMe(false)
        .setMimeTypes("application/vnd.google-apps.folder");

      const picker = new google.picker.PickerBuilder()
        .setAppId(config.projectNumber)
        .setOAuthToken(accessToken)
        .setDeveloperKey(config.apiKey)
        .addView(myDriveFolders)
        .addView(sharedFolders)
        .setTitle("Choose a Drive folder")
        .setCallback((data: PickerCallbackData) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs?.[0];
            if (doc) {
              fireOnPick({ folderId: doc.id, folderName: doc.name });
            }
            setMode("idle");
          } else if (data.action === google.picker.Action.CANCEL) {
            setMode("idle");
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open picker.";
      setError(message);
      setMode("error");
    }
  }, [connectionId, config, fireOnPick]);

  // ---- Fallback: manual folder ID submit ---------------------------------

  const submitManual = useCallback(async () => {
    setMode("loading");
    setError(null);
    const folderId = manualId.trim();

    try {
      const res = await fetch("/api/google/verify-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, folderId }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | { valid: true; folderId: string; folderName: string }
        | { valid: false; reason: string; message?: string }
        | { error: string };

      if (!res.ok || "error" in body) {
        throw new Error(("error" in body && body.error) || `Request failed (${res.status})`);
      }
      if (!("valid" in body) || !body.valid) {
        const reason = "reason" in body ? body.reason : "not_found";
        throw new Error(humanizeReason(reason));
      }

      fireOnPick({ folderId: body.folderId, folderName: body.folderName });
      setShowManual(false);
      setManualId("");
      setMode("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to verify folder.";
      setError(message);
      setMode("error");
    }
  }, [connectionId, manualId, fireOnPick]);

  const busy = mode === "loading";

  return (
    <div className="space-y-3">
      {selected && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-100">
          <Check className="h-4 w-4 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{selected.folderName}</p>
            <p className="truncate font-mono text-xs text-green-700/80 dark:text-green-200/70">
              {selected.folderId}
            </p>
          </div>
        </div>
      )}

      {!showManual ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="btn-primary text-sm"
          >
            <Folder className="h-4 w-4" />
            {busy ? "Opening…" : selected ? "Change folder" : "Pick a folder"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowManual(true);
              setError(null);
            }}
            className="text-sm text-brand hover:underline"
          >
            Or paste folder ID manually
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor="manual-folder-id" className="label">
            Google Drive folder ID
          </label>
          <p className="text-xs text-ink-500">
            Open the folder in Drive — the ID is the long string at the end of the URL after{" "}
            <code className="rounded bg-ink-100 px-1 dark:bg-ink-900">/folders/</code>.
          </p>
          <input
            id="manual-folder-id"
            type="text"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz"
            className="input font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submitManual}
              disabled={busy || !manualId.trim()}
              className="btn-primary text-sm"
            >
              <FolderPlus className="h-4 w-4" />
              {busy ? "Verifying…" : "Verify folder"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowManual(false);
                setError(null);
              }}
              className="text-sm text-brand hover:underline"
            >
              Or use picker
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function humanizeReason(reason: string): string {
  switch (reason) {
    case "not_found":
      return "We couldn't find that folder. Double-check the ID.";
    case "no_access":
      return "Your Google account doesn't have access to that folder.";
    case "trashed":
      return "That folder is in the trash. Restore it in Drive first.";
    case "not_a_folder":
      return "That ID points to a file, not a folder.";
    case "api_error":
      return "Google Drive returned an error verifying the folder.";
    default:
      return "Couldn't verify the folder.";
  }
}
