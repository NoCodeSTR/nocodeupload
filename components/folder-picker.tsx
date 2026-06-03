"use client";

/**
 * FolderPicker — "Pick a folder" via the Google Picker.
 *
 *   1. Lazy-load https://apis.google.com/js/api.js on first click.
 *   2. Load the 'picker' gapi module.
 *   3. POST /api/google/picker-token to mint a fresh access token for this
 *      connection (held in memory for the picker session, not persisted).
 *   4. Build a folder-only picker. Selecting a folder grants the app per-folder
 *      access under drive.file — no broad read scope needed.
 *   5. On selection, fire `onPick({folderId, folderName})`.
 *
 * (The old manual "paste folder ID" fallback was removed with the drive.file
 * scope swap — drive.file can't access arbitrary folders the user didn't pick,
 * so the Picker is now the only selection path.)
 */
import { useCallback, useState } from "react";
import { Folder, Check, AlertCircle } from "lucide-react";

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

      // Single folders view. (We previously added a second "shared with me"
      // view, but both render with the label "Folders", producing a confusing
      // duplicate tab. One view covering the user's Drive folders is what STR
      // hosts need; revisit shared-drive support if requested.)
      const folderView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes("application/vnd.google-apps.folder");

      const picker = new google.picker.PickerBuilder()
        .setAppId(config.projectNumber)
        .setOAuthToken(accessToken)
        .setDeveloperKey(config.apiKey)
        .addView(folderView)
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

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={openPicker} disabled={busy} className="btn-primary text-sm">
          <Folder className="h-4 w-4" />
          {busy ? "Opening…" : selected ? "Change folder" : "Pick a folder"}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
