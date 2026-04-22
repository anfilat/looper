import type { Phrase } from "./types";

const LOOP_GAP_MS = 200;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_SPEED_INDEX = 2;

export class PhrasePlayer {
  private video: HTMLVideoElement;
  private phrases: Phrase[];
  private currentIndex: number = 0;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private speedIndex: number = DEFAULT_SPEED_INDEX;
  private onPhraseChange?: (index: number) => void;

  constructor(
    video: HTMLVideoElement,
    phrases: Phrase[],
    startIndex: number = 0,
    onPhraseChange?: (index: number) => void
  ) {
    this.video = video;
    this.phrases = phrases;
    this.onPhraseChange = onPhraseChange;
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
    this.clearLoopTimer();
    this.video.pause();
  }

  resume(): void {
    this.video.play();
    this.watchLoop();
  }

  destroy(): void {
    this.clearLoopTimer();
    this.video.removeEventListener("timeupdate", this.handleTimeUpdate);
  }

  private playPhrase(index: number): void {
    this.clearLoopTimer();
    this.currentIndex = index;
    const phrase = this.phrases[index];
    this.video.currentTime = phrase.startTimeMs / 1000;
    this.video.play();
    this.watchLoop();
    this.onPhraseChange?.(index);
  }

  private watchLoop(): void {
    this.video.removeEventListener("timeupdate", this.handleTimeUpdate);
    this.video.addEventListener("timeupdate", this.handleTimeUpdate);
  }

  private handleTimeUpdate = (): void => {
    const phrase = this.currentPhrase;
    if (!phrase) return;

    if (this.video.currentTime * 1000 >= phrase.endTimeMs) {
      this.video.pause();
      this.clearLoopTimer();
      this.loopTimer = setTimeout(() => {
        this.video.currentTime = phrase.startTimeMs / 1000;
        this.video.play();
      }, LOOP_GAP_MS);
    }
  };

  private clearLoopTimer(): void {
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }
}
