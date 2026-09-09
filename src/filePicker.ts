import { isFsAccessSupported, loadRecents, removeRecent } from "./recents";

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

export interface FilePickerCallbacks {
  /** Fresh files were selected (drop, system picker or file input). */
  onSelect(selection: FileSelection): void;
  /** A recent entry was clicked; the app resolves permissions and re-opens it. */
  onOpenRecent(id: string): void;
}

/** Initial screen: drop zone plus the list of recently opened videos. */
export class FilePickerScreen {
  constructor(
    private container: HTMLElement,
    private callbacks: FilePickerCallbacks
  ) {
    this.render();
  }

  /** Re-render the recents list after entries changed. */
  refreshRecents(): void {
    this.renderRecentList();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="file-picker">
        <div class="file-picker-inner">
          <div class="drop-zone" id="dropZone">
            <p>Drop video + json3 subtitle files here</p>
            <p class="hint">or click to select files</p>
            <input type="file" id="fileInput" multiple accept=".mp4,.webm,.json3" />
          </div>
          <div class="recents" id="recents" hidden>
            <p class="recents-title">Recent</p>
            <ul class="recents-list" id="recentsList"></ul>
          </div>
        </div>
      </div>
    `;

    const dropZone = this.container.querySelector("#dropZone") as HTMLElement;
    const fileInput = this.container.querySelector(
      "#fileInput"
    ) as HTMLInputElement;

    dropZone.addEventListener("click", () => void this.pickFiles(fileInput));
    dropZone.addEventListener("dragover", (e) => e.preventDefault());
    dropZone.addEventListener("drop", (e) => {
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
        (handles) => void this.handleSelection(files, handles),
        () => void this.handleSelection(files, fileItems.map(() => null))
      );
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files) {
        void this.handleSelection(Array.from(fileInput.files), []);
      }
    });

    const recentsList = this.container.querySelector("#recentsList");
    recentsList?.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const removeButton = target.closest<HTMLElement>(".recent-remove");
      if (removeButton) {
        const id = removeButton.dataset.id;
        if (id) void removeRecent(id).then(() => this.renderRecentList());
        return;
      }
      const item = target.closest<HTMLElement>(".recent-item");
      const id = item?.dataset.id;
      if (id) this.callbacks.onOpenRecent(id);
    });

    this.renderRecentList();
  }

  private renderRecentList(): void {
    const recents = this.container.querySelector<HTMLElement>("#recents");
    const list = this.container.querySelector("#recentsList");
    if (!recents || !list) return;

    const entries = loadRecents();
    if (entries.length === 0) {
      recents.hidden = true;
      return;
    }
    recents.hidden = false;
    list.innerHTML = entries
      .map(
        (entry) => `
        <li class="recent-row">
          <button class="recent-item" data-id="${escapeHtml(entry.id)}" title="Open ${escapeHtml(entry.videoName)}">
            <span class="recent-name">${escapeHtml(entry.videoName)}</span>
          </button>
          <button class="recent-remove" data-id="${escapeHtml(entry.id)}" title="Remove from recent" aria-label="Remove from recent">×</button>
        </li>`
      )
      .join("");
  }

  /** Select files via the File System Access API (gives us persistent handles),
    * falling back to a plain file input where the API is unavailable. */
  private async pickFiles(fileInput: HTMLInputElement): Promise<void> {
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
      await this.handleSelection(files, handles);
    } catch (err) {
      // AbortError means the user closed the picker — nothing to do.
      if ((err as DOMException)?.name !== "AbortError") {
        fileInput.click();
      }
    }
  }

  private async handleSelection(
    files: File[],
    handles: (FileSystemFileHandle | null)[]
  ): Promise<void> {
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

    this.callbacks.onSelect({ videoFile, subtitleFile, videoHandle, subtitleHandle });
  }
}

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex !== -1 ? filename.slice(dotIndex).toLowerCase() : "";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
