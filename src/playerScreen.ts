import { PhrasePlayer } from "./player";
import type { Phrase } from "./types";

export interface PlayerScreenCallbacks {
  /** Called on every phrase change so the app can persist progress. */
  onPhraseChange(index: number): void;
  /** The video element failed to load or decode. */
  onVideoError(): void;
}

/** Player screen: video, subtitle overlay, HUD and keyboard/click controls.
  * Owns its document-level listeners; call destroy() before mounting another
  * screen into the same container. */
export class PlayerScreen {
  private container: HTMLElement;
  private video!: HTMLVideoElement;
  private subtitleOverlay!: HTMLElement;
  private phraseCounter!: HTMLElement;
  private speedLabel!: HTMLElement;
  private player!: PhrasePlayer;
  private subtitlesVisible = false;
  private videoUrl!: string;
  private destroyed = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "Space":
        e.preventDefault();
        this.player.togglePause();
        break;
      case "ArrowLeft":
        this.player.prevPhrase();
        break;
      case "ArrowRight":
        this.player.nextPhrase();
        break;
      case "ArrowUp":
        this.player.increaseSpeed();
        this.updateSpeedLabel();
        break;
      case "ArrowDown":
        this.player.decreaseSpeed();
        this.updateSpeedLabel();
        break;
      case "KeyS":
        this.toggleSubtitles();
        break;
      case "Digit0":
      case "Home":
        this.player.goToStart();
        break;
    }
  };

  // Mouse click anywhere in the app toggles playback, same as Space.
  private readonly onDocumentClick = (): void => {
    this.player.togglePause();
  };

  constructor(
    container: HTMLElement,
    videoFile: File,
    phrases: Phrase[],
    startIndex: number,
    private callbacks: PlayerScreenCallbacks
  ) {
    this.container = container;
    this.render(videoFile);
    this.player = new PhrasePlayer(
      this.video,
      phrases,
      startIndex,
      (index) => this.handlePhraseChange(index)
    );

    this.video.addEventListener("loadeddata", () => {
      this.player.start();
      this.updateCounter();
      this.updateSpeedLabel();
    }, { once: true });

    this.video.addEventListener("error", () => {
      if (!this.destroyed) this.callbacks.onVideoError();
    });

    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("click", this.onDocumentClick);
  }

  /** Tear down: remove global listeners and free the object URL. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("click", this.onDocumentClick);
    URL.revokeObjectURL(this.videoUrl);
  }

  private render(videoFile: File): void {
    this.videoUrl = URL.createObjectURL(videoFile);
    this.container.innerHTML = `
      <div class="player">
        <video id="video" src="${this.videoUrl}"></video>
        <div class="subtitle-overlay" id="subtitleOverlay"></div>
        <div class="phrase-counter" id="phraseCounter"></div>
        <div class="speed-label" id="speedLabel"></div>
      </div>
    `;

    this.video = this.container.querySelector("#video") as HTMLVideoElement;
    this.subtitleOverlay = this.container.querySelector(
      "#subtitleOverlay"
    ) as HTMLElement;
    this.phraseCounter = this.container.querySelector(
      "#phraseCounter"
    ) as HTMLElement;
    this.speedLabel = this.container.querySelector(
      "#speedLabel"
    ) as HTMLElement;
  }

  private handlePhraseChange(index: number): void {
    if (this.subtitlesVisible) {
      const phrase = this.player.currentPhrase;
      this.subtitleOverlay.textContent = phrase ? phrase.text : "";
    }
    this.updateCounter();
    this.callbacks.onPhraseChange(index);
  }

  private toggleSubtitles(): void {
    if (this.subtitlesVisible) {
      this.subtitleOverlay.textContent = "";
      this.subtitlesVisible = false;
    } else {
      const phrase = this.player.currentPhrase;
      if (phrase) {
        this.subtitleOverlay.textContent = phrase.text;
      }
      this.subtitlesVisible = true;
    }
  }

  private updateCounter(): void {
    this.phraseCounter.textContent = `${this.player.phraseIndex + 1} / ${this.player.totalPhrases}`;
  }

  private updateSpeedLabel(): void {
    this.speedLabel.textContent = `${this.player.speed}x`;
  }
}
