import { useCallback, useEffect, useRef, useState } from "react";
import { parsePhrases } from "./parser";
import {
  addRecent,
  getRecentHandles,
  loadRecents,
  recentId as toRecentId,
  removeRecent,
  touchRecent,
  type RecentEntry,
} from "./recents";
import { FilePickerScreen, type FileSelection } from "./screens/FilePickerScreen";
import { PlayerScreen } from "./screens/PlayerScreen";
import type { Json3Data, Phrase } from "./types";

type Screen =
  | { kind: "picker" }
  | { kind: "player"; videoFile: File; phrases: Phrase[]; startIndex: number };

/** Restore the last watched phrase for a video (same keys as before the React migration). */
function loadProgress(videoFileName: string): number {
  const saved = localStorage.getItem(`looper:${videoFileName}`);
  if (saved) {
    const index = parseInt(saved, 10);
    return isNaN(index) ? 0 : index;
  }
  return 0;
}

/** App — thin orchestrator. Owns the current screen, the recents list and
  * progress persistence, and drives the shared "open files" flow used by
  * drops, the system picker and recents. */
export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "picker" });
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  /** Id of the recent entry for the currently open video, if any. */
  const currentRecentIdRef = useRef<string | null>(null);
  const currentVideoNameRef = useRef("");

  const refreshRecents = useCallback(() => setRecents(loadRecents()), []);

  useEffect(() => {
    refreshRecents();
  }, [refreshRecents]);

  // --- Opening files ------------------------------------------------------

  /** Show an error and drop the corresponding recent entry, if there is one. */
  const failOpen = useCallback(
    async (recentId: string | null, message: string): Promise<void> => {
      currentRecentIdRef.current = null;
      if (recentId) {
        await removeRecent(recentId);
        refreshRecents();
      }
      alert(message);
    },
    [refreshRecents]
  );

  /** Shared open path for all sources (drop, picker, recents). */
  const openFiles = useCallback(
    async (
      videoFile: File,
      subtitleFile: File,
      handles: FileSelection | null,
      recentId: string | null
    ): Promise<void> => {
      currentRecentIdRef.current = recentId;

      let jsonData: unknown;
      try {
        jsonData = JSON.parse(await subtitleFile.text());
      } catch {
        await failOpen(recentId, "Invalid JSON file. Please upload a valid .json3 subtitle file.");
        return;
      }
      const phrases = parsePhrases(jsonData as Json3Data);

      if (phrases.length === 0) {
        await failOpen(recentId, "No phrases found in subtitle file");
        return;
      }

      if (recentId) {
        await touchRecent(recentId, videoFile.name);
      } else if (handles?.videoHandle && handles.subtitleHandle) {
        try {
          await addRecent(videoFile, {
            video: handles.videoHandle,
            subtitle: handles.subtitleHandle,
          });
          currentRecentIdRef.current = toRecentId(videoFile);
          refreshRecents();
        } catch {
          // Storage unavailable — recents are best-effort, playback is unaffected.
        }
      }

      currentVideoNameRef.current = videoFile.name;
      const startIndex = loadProgress(videoFile.name);
      setScreen({ kind: "player", videoFile, phrases, startIndex });
    },
    [failOpen, refreshRecents]
  );

  /** Re-open a recent entry: ask for permission, read both files, load them.
    * Any failure removes the entry from the list. */
  const openRecent = useCallback(
    async (id: string): Promise<void> => {
      const entry = recents.find((item) => item.id === id);
      if (!entry) {
        refreshRecents();
        return;
      }

      const handles = await getRecentHandles(id);
      if (!handles) {
        await failOpen(id, `Could not re-open "${entry.videoName}" — saved access to the files is gone. Removed from recent.`);
        return;
      }

      try {
        for (const handle of [handles.video, handles.subtitle]) {
          let permission =
            (await handle.queryPermission?.({ mode: "read" })) ?? "granted";
          if (permission === "prompt") {
            permission =
              (await handle.requestPermission?.({ mode: "read" })) ?? "denied";
          }
          if (permission !== "granted") {
            throw new Error("Permission denied");
          }
        }
        const videoFile = await handles.video.getFile();
        const subtitleFile = await handles.subtitle.getFile();
        await openFiles(videoFile, subtitleFile, null, id);
      } catch {
        await failOpen(id, `Could not load "${entry.videoName}". Removed from recent.`);
      }
    },
    [recents, failOpen, openFiles, refreshRecents]
  );

  // --- Progress -----------------------------------------------------------

  const handlePhraseChange = useCallback((index: number): void => {
    localStorage.setItem(
      `looper:${currentVideoNameRef.current}`,
      String(index)
    );
  }, []);

  /** The video blob could not be decoded / read — back to the picker, and if
    * this open came from (or produced) a recent entry, remove it. */
  const handleVideoError = useCallback((): void => {
    const videoName = currentVideoNameRef.current;
    const recentId = currentRecentIdRef.current;
    currentRecentIdRef.current = null;
    setScreen({ kind: "picker" });
    if (recentId) {
      void removeRecent(recentId).then(refreshRecents);
    }
    alert(`Could not load video "${videoName}".`);
  }, [refreshRecents]);

  const handleRemoveRecent = useCallback(
    (id: string): void => {
      void removeRecent(id).then(refreshRecents);
    },
    [refreshRecents]
  );

  // --- Screens ------------------------------------------------------------

  if (screen.kind === "player") {
    return (
      <PlayerScreen
        key={`${screen.videoFile.name}:${screen.videoFile.lastModified}`}
        videoFile={screen.videoFile}
        phrases={screen.phrases}
        startIndex={screen.startIndex}
        onPhraseChange={handlePhraseChange}
        onVideoError={handleVideoError}
      />
    );
  }

  return (
    <FilePickerScreen
      recents={recents}
      onSelect={(selection) =>
        void openFiles(
          selection.videoFile,
          selection.subtitleFile,
          selection,
          null
        )
      }
      onOpenRecent={(id) => void openRecent(id)}
      onRemoveRecent={handleRemoveRecent}
    />
  );
}
