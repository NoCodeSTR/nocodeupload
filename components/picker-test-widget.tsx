"use client";

/**
 * M5 verification widget — lives on the Settings page under each Google
 * Drive connection until M6 wires the picker into the upload-link creation
 * form. Lets Sean verify Picker SDK + API key + OAuth scope + origin
 * restrictions all line up before M6 depends on them.
 *
 * Remove this component (and its mount in app/(dashboard)/settings/page.tsx)
 * once M6 lands.
 */
import { useState } from "react";
import { FolderPicker } from "./folder-picker";

interface PickerTestWidgetProps {
  connectionId: string;
  config: { apiKey: string; projectNumber: string };
}

export function PickerTestWidget({ connectionId, config }: PickerTestWidgetProps) {
  const [picked, setPicked] = useState<{ folderId: string; folderName: string } | null>(
    null,
  );

  return (
    <div className="mt-4 border-t border-ink-200 pt-4 dark:border-ink-700">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        Test folder picker
      </p>
      <p className="mt-1 text-xs text-ink-500">
        Verify the Picker SDK, API key, and OAuth scope are wired correctly. M6
        will replace this widget with the upload-link creation form.
      </p>
      <div className="mt-3">
        <FolderPicker
          connectionId={connectionId}
          config={config}
          onPick={setPicked}
          initialFolder={picked}
        />
      </div>
    </div>
  );
}
