import type { Phrase } from "./types";

export const LOOP_GAP_MS = 500;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_SPEED_INDEX = 2;

export class PhrasePlayer {
  private video: HTMLVideoElement;
  private phrases: Phrase[];
  private currentIndex: number = 0;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private animationFrameId: number | null = null;
  private isPlaying: boolean = false;
  private speedIndex: number = DEFAULT_SPEED_INDEX;
  private onChange?: () => void;

  constructor(
    video: HTMLVideoElement,
    phrases: Phrase[],
    startIndex: number = 0,
    onChange?: () => void
  ) {
    this.video = video;
    this.phrases = phrases;
    this.onChange = onChange;
    this.currentIndex = startIndex;
  }

  start(): void {
    this.playPhrase(this.currentIndex);
  }

  get currentPhrase(): Phrase | undefined {
    return this.phrases[this.currentIndex];
  }

  get phraseIndex(): number {
    return this.currentIndex;
  }

  get totalPhrases(): number {
    return this.phrases.length;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  nextPhrase(): void {
    if (this.currentIndex < this.phrases.length - 1) {
      this.playPhrase(this.currentIndex + 1);
    }
  }

  prevPhrase(): void {
    if (this.currentIndex > 0) {
      this.playPhrase(this.currentIndex - 1);
    }
  }

  goToStart(): void {
    this.playPhrase(0);
  }

  increaseSpeed(): void {
    if (this.speedIndex < SPEEDS.length - 1) {
      this.speedIndex++;
      this.video.playbackRate = SPEEDS[this.speedIndex];
    }
  }

  decreaseSpeed(): void {
    if (this.speedIndex > 0) {
      this.speedIndex--;
      this.video.playbackRate = SPEEDS[this.speedIndex];
    }
  }

  get speed(): number {
    return SPEEDS[this.speedIndex];
  }

  pause(): void {
    this.isPlaying = false;
    this.clearLoopTimer();
    this.cancelAnimationFrame();
    this.video.pause();
  }

  resume(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    // A loop restart is already scheduled — it will resume playback on its own.
    if (this.loopTimer !== null) return;
    this.video.play();
    this.watchLoop();
  }

  togglePause(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.resume();
    }
  }

  destroy(): void {
    this.clearLoopTimer();
    this.cancelAnimationFrame();
  }

  private playPhrase(index: number): void {
    this.clearLoopTimer();
    this.isPlaying = true;
    this.currentIndex = index;
    this.playFromPhraseStart();
    this.notify();
  }

  /** Seek to the start of the current phrase and keep watching it. */
  private playFromPhraseStart(): void {
    const phrase = this.currentPhrase;
    if (!phrase) return;
    this.video.currentTime = phrase.startTimeMs / 1000;
    this.video.play();
    this.watchLoop();
  }

  private watchLoop(): void {
    this.cancelAnimationFrame();
    this.animationFrameId = requestAnimationFrame(this.handleTimeUpdate);
  }

  private handleTimeUpdate = (): void => {
    const phrase = this.currentPhrase;
    if (!phrase) return;

    if (this.video.currentTime * 1000 >= phrase.endTimeMs - 100) {
      this.video.pause();
      this.clearLoopTimer();
      this.loopTimer = setTimeout(() => {
        this.loopTimer = null;
        if (this.isPlaying) this.playFromPhraseStart();
      }, LOOP_GAP_MS);
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.handleTimeUpdate);
  };

  private notify(): void {
    this.onChange?.();
  }

  private clearLoopTimer(): void {
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private cancelAnimationFrame(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
