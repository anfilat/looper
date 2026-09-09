import { useRef } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { isFsAccessSupported, type RecentEntry } from "../recents";
import styles from "./FilePickerScreen.module.css";

const VIDEO_EXTENSIONS = [".mp4", ".webm"];
const SUBTITLE_EXTENSION = ".json3";

/** File System Access handles for freshly selected files, when available. */
export interface FileHandles {
  videoHandle: FileSystemFileHandle | null;
  subtitleHandle: FileSystemFileHandle | null;
}

/** A complete video + subtitles pair chosen by the user. */
export interface FileSelection extends FileHandles {
  videoFile: File;
  subtitleFile: File;
}

export interface FilePickerScreenProps {
  recents: RecentEntry[];
  /** Fresh files were selected (drop, system picker or file input). */
  onSelect(selection: FileSelection): void;
  /** A recent entry was clicked; the app resolves permissions and re-opens it. */
  onOpenRecent(id: string): void;
  /** The × button next to a recent entry was clicked. */
  onRemoveRecent(id: string): void;
}

/** Initial screen: drop zone plus the list of recently opened videos. */
export function FilePickerScreen({
  recents,
  onSelect,
  onOpenRecent,
  onRemoveRecent,
}: FilePickerScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Select files via the File System Access API (gives us persistent handles),
    * falling back to a plain file input where the API is unavailable. */
  const pickFiles = async (): Promise<void> => {
    const fileInput = fileInputRef.current;
    if (!fileInput) return;
    if (!isFsAccessSupported() || !window.showOpenFilePicker) {
      fileInput.click();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "Video and subtitles",
            accept: {
              "video/mp4": [".mp4"],
              "video/webm": [".webm"],
              "application/json": [".json3"],
            },
          },
        ],
      });
      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      await handleSelection(files, handles);
    } catch (err) {
      // AbortError means the user closed the picker — nothing to do.
      if ((err as DOMException)?.name !== "AbortError") {
        fileInput.click();
      }
    }
  };

  const handleSelection = async (
    files: File[],
    handles: (FileSystemFileHandle | null)[]
  ): Promise<void> => {
    let videoFile: File | null = null;
    let videoHandle: FileSystemFileHandle | null = null;
    let subtitleFile: File | null = null;
    let subtitleHandle: FileSystemFileHandle | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const handle = handles[i] ?? null;
      const ext = getExtension(file.name);
      if (VIDEO_EXTENSIONS.includes(ext)) {
        videoFile = file;
        videoHandle = handle;
      } else if (ext === SUBTITLE_EXTENSION) {
        subtitleFile = file;
        subtitleHandle = handle;
      }
    }

    if (!videoFile || !subtitleFile) {
      alert("Please select a video file (.mp4/.webm) and a subtitle file (.json3)");
      return;
    }

    onSelect({ videoFile, subtitleFile, videoHandle, subtitleHandle });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;
    const files = Array.from(dataTransfer.files);
    const fileItems = Array.from(dataTransfer.items).filter(
      (item) => item.kind === "file"
    );
    // Handles must be requested synchronously, before this handler yields:
    // the DataTransferItemList becomes unusable once the event dispatch ends.
    const handlePromises = fileItems.map((item) =>
      item.getAsFileSystemHandle
        ? item.getAsFileSystemHandle()
        : Promise.resolve(null)
    );
    Promise.all(handlePromises).then(
      (handles) => void handleSelection(files, handles),
      () => void handleSelection(files, fileItems.map(() => null))
    );
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files) {
      void handleSelection(Array.from(e.target.files), []);
      // Allow re-selecting the same file after a failed open.
      e.target.value = "";
    }
  };

  return (
    <div className={styles.filePicker}>
      <div className={styles.filePickerInner}>
        {/* Kept outside the drop zone: the synthetic click from input.click()
            must not bubble back into the drop-zone click handler. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".mp4,.webm,.json3"
          hidden
          onChange={onInputChange}
        />
        <div
          className={styles.dropZone}
          onClick={() => void pickFiles()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <p>Drop video + json3 subtitle files here</p>
          <p className={styles.hint}>or click to select files</p>
        </div>
        {recents.length > 0 && (
          <div className={styles.recents}>
            <p className={styles.recentsTitle}>Recent</p>
            <ul className={styles.recentsList}>
              {recents.map((entry) => (
                <li key={entry.id} className={styles.recentRow}>
                  <button
                    className={styles.recentItem}
                    title={`Open ${entry.videoName}`}
                    onClick={() => onOpenRecent(entry.id)}
                  >
                    <span>{entry.videoName}</span>
                  </button>
                  <button
                    className={styles.recentRemove}
                    title="Remove from recent"
                    aria-label="Remove from recent"
                    onClick={() => onRemoveRecent(entry.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex !== -1 ? filename.slice(dotIndex).toLowerCase() : "";
}
