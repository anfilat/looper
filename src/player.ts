import type { Phrase } from "./types";

const LOOP_GAP_MS = 200;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_SPEED_INDEX = 2;

export type PlaybackMode = "phrase" | "word";

interface LoopRange {
  startMs: number;
  endMs: number;
}

export class PhrasePlayer {
  private video: HTMLVideoElement;
  private phrases: Phrase[];
  private currentIndex: number = 0;
  private currentWordIndex: number = 0;
  private mode: PlaybackMode = "phrase";
  /** P key: one-shot playback from the phrase start to the current word. */
  private prefixPlaying: boolean = false;
  private wasPlayingBeforePrefix: boolean = false;
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

  get wordIndex(): number {
    return this.currentWordIndex;
  }

  get currentMode(): PlaybackMode {
    return this.mode;
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

  /** W: switch between looping the whole phrase and a single word. */
  toggleMode(): void {
    this.mode = this.mode === "phrase" ? "word" : "phrase";
    this.prefixPlaying = false;
    this.clearLoopTimer();
    this.isPlaying = true;
    this.playUnit();
    this.notify();
  }

  /** X (word mode only): loop the next word of the current phrase. */
  nextWord(): void {
    const phrase = this.currentPhrase;
    if (
      this.mode === "word" &&
      phrase &&
      this.currentWordIndex < phrase.words.length - 1
    ) {
      this.playWord(this.currentWordIndex + 1);
    }
  }

  /** Z (word mode only): loop the previous word of the current phrase. */
  prevWord(): void {
    if (this.mode === "word" && this.currentWordIndex > 0) {
      this.playWord(this.currentWordIndex - 1);
    }
  }

  /** P (word mode): play the phrase from its start to the current word
   *  once, then restore what was happening before — word looping, or a
   *  pause parked at the word start. */
  playToCurrentWord(): void {
    const phrase = this.currentPhrase;
    if (this.mode !== "word" || !phrase || !phrase.words[this.currentWordIndex])
      return;

    this.wasPlayingBeforePrefix = this.isPlaying;
    this.prefixPlaying = true;
    this.clearLoopTimer();
    this.isPlaying = true;
    this.video.currentTime = phrase.startTimeMs / 1000;
    this.video.play();
    this.watchLoop();
    this.notify();
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
    this.currentWordIndex = 0;
    this.prefixPlaying = false;
    this.playUnit();
    this.notify();
  }

  private playWord(index: number): void {
    this.clearLoopTimer();
    this.isPlaying = true;
    this.currentWordIndex = index;
    this.prefixPlaying = false;
    this.playUnit();
    this.notify();
  }

  /** Seek to the start of the current loop range and keep watching it. */
  private playUnit(): void {
    const range = this.loopRange();
    if (!range) return;
    this.video.currentTime = range.startMs / 1000;
    this.video.play();
    this.watchLoop();
  }

  /** The looping interval: the current word, the whole phrase, or — while
   *  the P prefix plays — phrase start → current word end. Falls back to
   *  the phrase when the phrase has no word timings. */
  private loopRange(): LoopRange | null {
    const phrase = this.currentPhrase;
    if (!phrase) return null;
    if (this.mode === "word") {
      const word = phrase.words[this.currentWordIndex];
      if (word) {
        return {
          startMs: this.prefixPlaying ? phrase.startTimeMs : word.startTimeMs,
          endMs: word.endTimeMs,
        };
      }
    }
    return { startMs: phrase.startTimeMs, endMs: phrase.endTimeMs };
  }

  private watchLoop(): void {
    this.cancelAnimationFrame();
    this.animationFrameId = requestAnimationFrame(this.handleTimeUpdate);
  }

  private handleTimeUpdate = (): void => {
    const range = this.loopRange();
    if (!range) return;

    if (this.video.currentTime * 1000 >= range.endMs - 100) {
      this.video.pause();
      this.clearLoopTimer();
      this.loopTimer = setTimeout(() => {
        this.loopTimer = null;
        this.finishPrefixIfNeeded();
        if (this.isPlaying) this.playUnit();
      }, LOOP_GAP_MS);
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.handleTimeUpdate);
  };

  /** After one-shot prefix playback, restore the pre-P state: word looping,
   *  or a pause parked at the word start. */
  private finishPrefixIfNeeded(): void {
    if (!this.prefixPlaying) return;
    this.prefixPlaying = false;
    if (!this.wasPlayingBeforePrefix) {
      this.isPlaying = false;
      const range = this.loopRange(); // already the word range again
      if (range) this.video.currentTime = range.startMs / 1000;
    }
    this.notify();
  }

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
