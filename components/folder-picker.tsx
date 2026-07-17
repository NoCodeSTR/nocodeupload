"use client";

/**
 * FolderPicker — "Pick a folder" via the Google Picker.
 *
 *   1. Lazy-load the Picker SDK (apis.google.com) + Google Identity Services.
 *   2. Ask GIS for a drive.file access token IN THE BROWSER.
 *   3. Build a folder-only picker with that token. Selecting a folder grants the
 *      app per-folder access under drive.file — no broad read scope needed.
 *   4. On selection, fire `onPick({folderId, folderName})`.
 *
 * WHY THE TOKEN IS MINTED IN THE BROWSER (do not "optimize" this back to a
 * server-minted token):
 * The Picker renders the user's Drive using the BROWSER'S Google session — not
 * the OAuth token we hand it. The token only authorizes the API calls. NoCode
 * Upload signs users in with Supabase (email/password), which never creates a
 * Google session, so a server-minted token left the Picker with no signed-in
 * Google user and it failed with "403 — you do not have access to this page":
 * a white, unclosable overlay. It only ever worked for people who happened to
 * be signed into Google in that browser as the connected account.
 *
 * Requesting the token via GIS fixes both failure modes at once — it signs the
 * user into Google as part of the flow, and `hint` preselects the account that's
 * actually connected, so the session and the token always agree.
 *
 * The picked folder grants access to the APP (the OAuth client), not to this one
 * token — so the server-side uploader keeps working with its own stored token.
 * Still drive.file; no scope change.
 *
 * Requires the app origin to be listed under the OAuth client's "Authorized
 * JavaScript origins" in Google Cloud, or GIS refuses to issue a token.
 *
 * (The old manual "paste folder ID" fallback was removed with the drive.file
 * scope swap — drive.file can't access arbitrary folders the user didn't pick,
 * so the Picker is now the only selection path for pre-existing folders.
 * "New folder" goes through our server and needs no Google session at all.)
 */
import { useCallback, useEffect, useState } from "react";
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
  setOrigin(origin: string): PickerBuilder;
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

// ----- Google Identity Services types (browser-side OAuth token) ------------

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
    /** Preselects this account in Google's chooser. */
    hint?: string;
  }): TokenClient;
}

declare global {
  interface Window {
    gapi?: GapiSdk;
    google?: {
      picker?: PickerSdk;
      accounts?: { oauth2: GisOAuth2 };
    };
  }
}

const GAPI_SCRIPT_SRC = "https://apis.google.com/js/api.js";
const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const BLOCKED_HINT =
  "An ad blocker or corporate proxy may be blocking Google. Disable it for this site and try again.";

let gapiScriptPromise: Promise<void> | null = null;
let pickerModulePromise: Promise<void> | null = null;
let gisScriptPromise: Promise<void> | null = null;

function loadScript(src: string, failureMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(failureMessage));
    document.head.appendChild(script);
  });
}

/** Ensure both the apis.google.com script and the picker module are loaded. */
async function loadPickerSdk(): Promise<void> {
  if (typeof window === "undefined") return;

  if (!window.gapi) {
    gapiScriptPromise ??= loadScript(
      GAPI_SCRIPT_SRC,
      `Couldn't load Google's picker script. ${BLOCKED_HINT}`,
    );
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

/** Ensure Google Identity Services (the browser-side token client) is loaded. */
async function loadGisSdk(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.google?.accounts?.oauth2) return;
  gisScriptPromise ??= loadScript(
    GIS_SCRIPT_SRC,
    `Couldn't load Google sign-in. ${BLOCKED_HINT}`,
  );
  await gisScriptPromise;
}

/**
 * Mint a drive.file access token in the browser. This is what gives the Picker
 * a signed-in Google session to render the user's Drive against — see the file
 * header for why a server-minted token can't work here.
 */
function requestDriveToken(clientId: string, hint?: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error(`Google sign-in didn't load. ${BLOCKED_HINT}`));
      return;
    }

    let settled = false;
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      ...(hint ? { hint } : {}),
      callback: (response) => {
        if (settled) return;
        settled = true;
        if (response.access_token) {
          resolve(response.access_token);
          return;
        }
        reject(
          new Error(
            response.error === "access_denied"
              ? "Google access was declined. Approve access to choose a folder, or use “New folder” instead."
              : "Google didn't return access. Please try again.",
          ),
        );
      },
      error_callback: (err) => {
        if (settled) return;
        settled = true;
        if (err?.type === "popup_closed") {
          reject(new Error("The Google sign-in window closed before an account was chosen."));
        } else if (err?.type === "popup_failed_to_open") {
          reject(
            new Error("Your browser blocked Google's sign-in popup. Allow popups for this site, then try again."),
          );
        } else {
          reject(new Error("Google sign-in failed. Please try again, or use “New folder” instead."));
        }
      },
    });

    client.requestAccessToken();
  });
}

// ----- Component -----------------------------------------------------------

export interface FolderPickerProps {
  connectionId: string;
  /** Public env values the picker SDK needs (passed in to avoid client-side env reads). */
  config: {
    apiKey: string;
    projectNumber: string;
    clientId: string;
  };
  /**
   * Email of the connected Google account. Preselects it in Google's account
   * chooser so the picker session matches the account files upload to.
   */
  accountEmail?: string | null;
  /** Fires when the user successfully picks (or pastes) a folder. */
  onPick: (folder: { folderId: string; folderName: string }) => void;
  /** Pre-selected folder, if any — shown in the "Currently selected" pill. */
  initialFolder?: { folderId: string; folderName: string } | null;
}

type Mode = "idle" | "loading" | "error";

export function FolderPicker({
  connectionId,
  config,
  accountEmail,
  onPick,
  initialFolder,
}: FolderPickerProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ folderId: string; folderName: string } | null>(
    initialFolder ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);

  const fireOnPick = useCallback(
    (folder: { folderId: string; folderName: string }) => {
      setSelected(folder);
      onPick(folder);
    },
    [onPick],
  );

  // Warm the SDKs up front. Google's token popup must be opened from the user's
  // click; if we were still awaiting a script load at that moment the browser
  // would treat the popup as unsolicited and block it.
  useEffect(() => {
    void loadPickerSdk().catch(() => {
      /* surfaced on click instead */
    });
    void loadGisSdk().catch(() => {
      /* surfaced on click instead */
    });
  }, []);

  // ---- Primary: open Google Picker ---------------------------------------

  const openPicker = useCallback(async () => {
    setMode("loading");
    setError(null);

    try {
      await Promise.all([loadPickerSdk(), loadGisSdk()]);

      // Browser-minted token — gives the Picker a real Google session and lets
      // the user land on the connected account. See the file header.
      const accessToken = await requestDriveToken(config.clientId, accountEmail);

      const { google } = window;
      if (!google?.picker) {
        throw new Error("Picker SDK didn't initialize as expected.");
      }
      const picker = google.picker;

      // Single folders view. (We previously added a second "shared with me"
      // view, but both render with the label "Folders", producing a confusing
      // duplicate tab. One view covering the user's Drive folders is what STR
      // hosts need; revisit shared-drive support if requested.)
      const folderView = new picker.DocsView(picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes("application/vnd.google-apps.folder");

      const built = new picker.PickerBuilder()
        .setAppId(config.projectNumber)
        .setOAuthToken(accessToken)
        .setDeveloperKey(config.apiKey)
        .setOrigin(window.location.origin)
        .addView(folderView)
        .setTitle("Choose a Drive folder")
        .setCallback((data: PickerCallbackData) => {
          if (data.action === picker.Action.PICKED) {
            const doc = data.docs?.[0];
            if (doc) {
              fireOnPick({ folderId: doc.id, folderName: doc.name });
            }
            setMode("idle");
          } else if (data.action === picker.Action.CANCEL) {
            setMode("idle");
          }
        })
        .build();

      built.setVisible(true);
      // Recover the button as soon as the picker is up rather than waiting on a
      // callback — if the picker ever fails to render, the control stays usable
      // instead of stranding the user on "Opening…" with no way back.
      setMode("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open picker.";
      setError(message);
      setMode("error");
    }
  }, [config, accountEmail, fireOnPick]);

  // ---- Create a new folder (Drive API; nested under the current selection) --

  const createNewFolder = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreatingBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/google/create-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, name, parentId: selected?.folderId ?? null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error === "provider_unavailable"
            ? "Couldn't reach Drive — reconnect the account in Settings."
            : "Couldn't create the folder.",
        );
      }
      const folder = (await res.json()) as { id: string; name: string };
      fireOnPick({ folderId: folder.id, folderName: folder.name });
      setNewName("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the folder.");
    } finally {
      setCreatingBusy(false);
    }
  }, [connectionId, newName, selected, fireOnPick]);

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
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn-secondary text-sm"
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </button>
        )}
      </div>

      {creating && (
        <div className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          <p className="text-xs text-ink-500">
            {selected ? `New folder inside “${selected.folderName}”` : "New folder in your Drive"}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createNewFolder();
                }
              }}
              placeholder="Folder name"
              maxLength={100}
              autoFocus
            />
            <button
              type="button"
              onClick={() => void createNewFolder()}
              disabled={creatingBusy}
              className="btn-primary text-sm"
            >
              {creatingBusy ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              className="btn-ghost text-sm"
            >
              Cancel
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
