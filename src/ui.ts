import { FilePickerScreen, type FileHandles } from "./filePicker";
import { parsePhrases } from "./parser";
import { PlayerScreen } from "./playerScreen";
import {
  addRecent,
  getRecentHandles,
  loadRecents,
  recentId as toRecentId,
  removeRecent,
  touchRecent,
} from "./recents";
import type { AppState, Json3Data } from "./types";

/**
 * AppUI — thin orchestrator. Owns the app state and progress persistence,
 * decides which screen (file picker / player) is mounted, and drives the
 * shared "open files" flow used by drops, the system picker and recents.
 */
export class AppUI {
  private container: HTMLElement;
  private picker: FilePickerScreen | null = null;
  private playerScreen: PlayerScreen | null = null;
  /** Id of the recent entry for the currently open video, if any. */
  private currentRecentId: string | null = null;
  private state: AppState = {
    phrases: [],
    currentIndex: 0,
    videoFileName: "",
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.showPicker();
  }

  // --- Screens ----------------------------------------------------------

  private showPicker(): void {
    this.playerScreen?.destroy();
    this.playerScreen = null;
    this.picker = new FilePickerScreen(this.container, {
      onSelect: (selection) =>
        void this.openFiles(
          selection.videoFile,
          selection.subtitleFile,
          selection,
          null
        ),
      onOpenRecent: (id) => void this.openRecent(id),
    });
  }

  private showPlayer(videoFile: File, startIndex: number): void {
    this.picker = null;
    this.playerScreen = new PlayerScreen(
      this.container,
      videoFile,
      this.state.phrases,
      startIndex,
      {
        onPhraseChange: (index) => this.onPhraseChange(index),
        onVideoError: () => this.handleVideoError(),
      }
    );
  }

  // --- Opening files ----------------------------------------------------

  /** Re-open a recent entry: ask for permission, read both files, load them.
    * Any failure removes the entry from the list. */
  private async openRecent(id: string): Promise<void> {
    const entry = loadRecents().find((item) => item.id === id);
    if (!entry) {
      this.picker?.refreshRecents();
      return;
    }

    const handles = await getRecentHandles(id);
    if (!handles) {
      await this.failOpen(id, `Could not re-open "${entry.videoName}" — saved access to the files is gone. Removed from recent.`);
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
      await this.openFiles(videoFile, subtitleFile, null, id);
    } catch {
      await this.failOpen(id, `Could not load "${entry.videoName}". Removed from recent.`);
    }
  }

  /** Shared open path for all sources (drop, picker, recents). */
  private async openFiles(
    videoFile: File,
    subtitleFile: File,
    handles: FileHandles | null,
    recentId: string | null
  ): Promise<void> {
    this.currentRecentId = recentId;

    let jsonData: unknown;
    try {
      jsonData = JSON.parse(await subtitleFile.text());
    } catch {
      await this.failOpen(recentId, "Invalid JSON file. Please upload a valid .json3 subtitle file.");
      return;
    }
    const phrases = parsePhrases(jsonData as Json3Data);

    if (phrases.length === 0) {
      await this.failOpen(recentId, "No phrases found in subtitle file");
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
        this.currentRecentId = toRecentId(videoFile);
      } catch {
        // Storage unavailable — recents are best-effort, playback is unaffected.
      }
    }

    const savedIndex = this.loadProgress(videoFile.name);
    this.state.phrases = phrases;
    this.state.videoFileName = videoFile.name;

    this.showPlayer(videoFile, savedIndex);
  }

  /** Show an error and drop the corresponding recent entry, if there is one. */
  private async failOpen(recentId: string | null, message: string): Promise<void> {
    this.currentRecentId = null;
    if (recentId) {
      await removeRecent(recentId);
      this.picker?.refreshRecents();
    }
    alert(message);
  }

  // --- Progress ---------------------------------------------------------

  private onPhraseChange(index: number): void {
    this.state.currentIndex = index;
    this.saveProgress();
  }

  /** The video blob could not be decoded / read — back to the picker, and if
    * this open came from (or produced) a recent entry, remove it. */
  private handleVideoError(): void {
    const videoName = this.state.videoFileName;
    const recentId = this.currentRecentId;
    this.currentRecentId = null;
    this.showPicker();
    if (recentId) {
      void removeRecent(recentId).then(() => this.picker?.refreshRecents());
    }
    alert(`Could not load video "${videoName}".`);
  }

  private saveProgress(): void {
    const key = `looper:${this.state.videoFileName}`;
    localStorage.setItem(key, String(this.state.currentIndex));
  }

  private loadProgress(videoFileName: string): number {
    const key = `looper:${videoFileName}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      const index = parseInt(saved, 10);
      return isNaN(index) ? 0 : index;
    }
    return 0;
  }
}
