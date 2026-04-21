import { parsePhrases } from "./parser";
import { PhrasePlayer } from "./player";
import type { AppState } from "./types";

const VIDEO_EXTENSIONS = [".mp4", ".webm"];
const SUBTITLE_EXTENSION = ".json3";

export class AppUI {
  private container: HTMLElement;
  private video: HTMLVideoElement | null = null;
  private player: PhrasePlayer | null = null;
  private subtitleOverlay: HTMLElement | null = null;
  private phraseCounter: HTMLElement | null = null;
  private currentVideoUrl: string | null = null;
  private state: AppState = {
    phrases: [],
    currentIndex: 0,
    subtitlesVisible: false,
    videoFileName: "",
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderFilePicker();
  }

  private renderFilePicker(): void {
    this.container.innerHTML = `
      <div class="file-picker">
        <div class="drop-zone" id="dropZone">
          <p>Drop video + json3 subtitle files here</p>
          <p class="hint">or click to select files</p>
          <input type="file" id="fileInput" multiple accept=".mp4,.webm,.json3" />
        </div>
      </div>
    `;

    const dropZone = this.container.querySelector("#dropZone") as HTMLElement;
    const fileInput = this.container.querySelector(
      "#fileInput"
    ) as HTMLInputElement;

    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("dragover", (e) => e.preventDefault());
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files) {
        this.handleFiles(e.dataTransfer.files);
      }
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files) {
        this.handleFiles(fileInput.files);
      }
    });
  }

  private async handleFiles(files: FileList): Promise<void> {
    let videoFile: File | null = null;
    let subtitleFile: File | null = null;

    for (const file of Array.from(files)) {
      const ext = this.getExtension(file.name);
      if (VIDEO_EXTENSIONS.includes(ext)) {
        videoFile = file;
      } else if (ext === SUBTITLE_EXTENSION) {
        subtitleFile = file;
      }
    }

    if (!videoFile || !subtitleFile) {
      alert("Please select a video file (.mp4/.webm) and a subtitle file (.json3)");
      return;
    }

    const jsonText = await subtitleFile.text();
    let jsonData;
    try {
      jsonData = JSON.parse(jsonText);
    } catch {
      alert("Invalid JSON file. Please upload a valid .json3 subtitle file.");
      return;
    }
    const phrases = parsePhrases(jsonData);

    if (phrases.length === 0) {
      alert("No phrases found in subtitle file");
      return;
    }

    const savedIndex = this.loadProgress(videoFile.name);
    this.state.phrases = phrases;
    this.state.videoFileName = videoFile.name;

    this.renderPlayer(videoFile, savedIndex);
  }

  private renderPlayer(videoFile: File, startIndex: number): void {
    if (this.currentVideoUrl) {
      URL.revokeObjectURL(this.currentVideoUrl);
    }
    const videoUrl = URL.createObjectURL(videoFile);
    this.currentVideoUrl = videoUrl;

    this.container.innerHTML = `
      <div class="player">
        <video id="video" src="${videoUrl}"></video>
        <div class="subtitle-overlay" id="subtitleOverlay"></div>
        <div class="phrase-counter" id="phraseCounter"></div>
      </div>
    `;

    this.video = this.container.querySelector("#video") as HTMLVideoElement;
    this.subtitleOverlay = this.container.querySelector(
      "#subtitleOverlay"
    ) as HTMLElement;
    this.phraseCounter = this.container.querySelector(
      "#phraseCounter"
    ) as HTMLElement;

    this.player = new PhrasePlayer(
      this.video,
      this.state.phrases,
      startIndex,
      (index) => this.onPhraseChange(index)
    );

    this.video.addEventListener("loadeddata", () => {
      this.player!.start();
      this.updateCounter();
    }, { once: true });

    this.setupKeyboard();
  }

  private setupKeyboard(): void {
    document.addEventListener("keydown", (e) => {
      if (!this.player) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          this.player.nextPhrase();
          break;
        case "ArrowLeft":
          this.player.prevPhrase();
          break;
        case "Period":
          this.toggleSubtitles();
          break;
        case "Digit0":
        case "Home":
          this.player.goToStart();
          break;
      }
    });
  }

  private toggleSubtitles(): void {
    if (!this.player || !this.subtitleOverlay) return;

    if (this.state.subtitlesVisible) {
      this.subtitleOverlay.textContent = "";
      this.state.subtitlesVisible = false;
      this.player.resume();
    } else {
      const phrase = this.player.currentPhrase;
      if (phrase) {
        this.subtitleOverlay.textContent = phrase.text;
      }
      this.state.subtitlesVisible = true;
      this.player.pause();
    }
  }

  private onPhraseChange(index: number): void {
    this.state.currentIndex = index;
    this.state.subtitlesVisible = false;
    if (this.subtitleOverlay) {
      this.subtitleOverlay.textContent = "";
    }
    this.updateCounter();
    this.saveProgress();
  }

  private updateCounter(): void {
    if (this.phraseCounter && this.player) {
      this.phraseCounter.textContent = `${this.player.phraseIndex + 1} / ${this.player.totalPhrases}`;
    }
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

  private getExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf(".");
    return dotIndex !== -1 ? filename.slice(dotIndex).toLowerCase() : "";
  }
}
