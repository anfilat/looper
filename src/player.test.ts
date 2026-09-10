import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PhrasePlayer } from "./player";
import type { Phrase } from "./types";

const LOOP_GAP_MS = 200;

const phrases: Phrase[] = [
  {
    startTimeMs: 1000,
    endTimeMs: 2000,
    text: "hello",
    words: [{ text: "hello", startTimeMs: 1000, endTimeMs: 2000 }],
  },
  {
    startTimeMs: 2000,
    endTimeMs: 3000,
    text: "my world",
    words: [
      { text: "my ", startTimeMs: 2000, endTimeMs: 2500 },
      { text: "world", startTimeMs: 2500, endTimeMs: 3000 },
    ],
  },
];

class FakeVideo {
  currentTime = 0;
  paused = true;
  play = vi.fn(() => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

let video: FakeVideo;
let rafCallbacks: FrameRequestCallback[] = [];
let lastRafId = 0;

function flushFrame(): void {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((cb) => cb(performance.now()));
}

describe("PhrasePlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    video = new FakeVideo();
    rafCallbacks = [];
    lastRafId = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback): number => {
        rafCallbacks.push(cb);
        return ++lastRafId;
      }
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function startPlayer(): PhrasePlayer {
    const player = new PhrasePlayer(video as unknown as HTMLVideoElement, phrases);
    player.start();
    return player;
  }

  /** Drive playback until the loop enters the gap between iterations. */
  function reachLoopGap(): void {
    flushFrame(); // first handleTimeUpdate: still playing, re-arms rAF
    video.currentTime = (phrases[0].endTimeMs - 100) / 1000;
    flushFrame(); // end reached: video paused, loop timer scheduled
  }

  it("loops back to the phrase start after the gap", () => {
    const player = startPlayer();
    reachLoopGap();

    expect(video.paused).toBe(true);
    expect(player.playing).toBe(true);

    vi.advanceTimersByTime(LOOP_GAP_MS);

    expect(video.currentTime).toBe(phrases[0].startTimeMs / 1000);
    expect(video.paused).toBe(false);
    expect(player.playing).toBe(true);
  });

  it("pausing during the loop gap stops the video (regression)", () => {
    const player = startPlayer();
    reachLoopGap();

    // In the gap the video element is paused, but the player is logically
    // playing — togglePause must still stop it (the Space key scenario).
    expect(video.paused).toBe(true);
    expect(player.playing).toBe(true);
    player.togglePause();

    expect(player.playing).toBe(false);

    // The pending loop-restart timer must have been cancelled: even after
    // the gap elapses, playback must not resume on its own.
    vi.advanceTimersByTime(LOOP_GAP_MS * 2);
    flushFrame();

    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe((phrases[0].endTimeMs - 100) / 1000);
  });

  it("resumes playback after being paused during the loop gap", () => {
    const player = startPlayer();
    reachLoopGap();
    player.pause();

    player.resume();

    expect(player.playing).toBe(true);
    // currentTime is past the phrase end, so the loop restarts it from the top.
    flushFrame();
    vi.advanceTimersByTime(LOOP_GAP_MS);
    expect(video.currentTime).toBe(phrases[0].startTimeMs / 1000);
    expect(video.paused).toBe(false);
  });

  it("togglePause from a paused state resumes playback", () => {
    const player = startPlayer();
    flushFrame();
    player.pause();

    video.currentTime = 1.5; // paused mid-phrase
    player.togglePause();

    expect(player.playing).toBe(true);
    expect(video.paused).toBe(false);
    flushFrame();
    expect(video.currentTime).toBe(1.5); // continues from where it stopped
  });

  it("resume is a no-op while already playing", () => {
    const player = startPlayer();
    flushFrame();

    player.resume();

    expect(video.play).toHaveBeenCalledTimes(1); // only the initial play
    expect(player.playing).toBe(true);
  });

  it("word mode loops only the current word", () => {
    const player = new PhrasePlayer(
      video as unknown as HTMLVideoElement,
      phrases,
      1
    );
    player.start();
    expect(player.currentMode).toBe("phrase");

    player.toggleMode();

    expect(player.currentMode).toBe("word");
    expect(video.currentTime).toBe(2); // first word of the phrase

    // Reach the word end → pause → gap → restart from the word start.
    flushFrame();
    video.currentTime = (2500 - 100) / 1000;
    flushFrame();
    expect(video.paused).toBe(true);

    vi.advanceTimersByTime(LOOP_GAP_MS);

    expect(video.currentTime).toBe(2);
    expect(video.paused).toBe(false);
  });

  it("X/Z move between words and clamp at phrase boundaries", () => {
    const player = new PhrasePlayer(
      video as unknown as HTMLVideoElement,
      phrases,
      1
    );
    player.start();
    player.toggleMode();

    player.nextWord();
    expect(player.wordIndex).toBe(1);
    expect(video.currentTime).toBe(2.5); // "world"

    player.nextWord(); // no third word — ignored
    expect(player.wordIndex).toBe(1);
    expect(video.currentTime).toBe(2.5);

    player.prevWord();
    expect(player.wordIndex).toBe(0);
    expect(video.currentTime).toBe(2); // "my"

    player.prevWord(); // no word before the first — ignored
    expect(player.wordIndex).toBe(0);
    expect(video.currentTime).toBe(2);
  });

  it("switching phrases in word mode resets to the first word", () => {
    const player = new PhrasePlayer(
      video as unknown as HTMLVideoElement,
      phrases,
      1
    );
    player.start();
    player.toggleMode();
    player.nextWord();
    expect(player.wordIndex).toBe(1);

    player.prevPhrase();

    expect(player.phraseIndex).toBe(0);
    expect(player.wordIndex).toBe(0);
    expect(player.currentMode).toBe("word");
    expect(video.currentTime).toBe(1); // first word of the previous phrase
  });

  it("P plays the phrase start up to the current word, then resumes the word loop", () => {
    const player = new PhrasePlayer(
      video as unknown as HTMLVideoElement,
      phrases,
      1
    );
    player.start();
    player.toggleMode();
    player.nextWord(); // "world" 2500–3000

    player.playToCurrentWord();

    // The prefix starts at the phrase start, not the word start.
    expect(video.currentTime).toBe(2);
    expect(video.paused).toBe(false);

    flushFrame();
    video.currentTime = (3000 - 100) / 1000; // prefix end = word end
    flushFrame();
    expect(video.paused).toBe(true);

    // After the gap the word loop resumes from the word start.
    vi.advanceTimersByTime(LOOP_GAP_MS);

    expect(video.currentTime).toBe(2.5);
    expect(video.paused).toBe(false);
  });

  it("P while paused returns to a pause parked at the word start", () => {
    const player = new PhrasePlayer(
      video as unknown as HTMLVideoElement,
      phrases,
      1
    );
    player.start();
    player.toggleMode();
    player.pause();

    player.playToCurrentWord();

    expect(video.paused).toBe(false);
    flushFrame();
    video.currentTime = (2500 - 100) / 1000; // end of the word "my"
    flushFrame();

    vi.advanceTimersByTime(LOOP_GAP_MS);

    expect(player.playing).toBe(false);
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(2); // back at the word start
  });

  it("X/Z are no-ops in phrase mode", () => {
    const player = new PhrasePlayer(
      video as unknown as HTMLVideoElement,
      phrases,
      1
    );
    player.start();

    player.nextWord();
    player.prevWord();

    expect(player.wordIndex).toBe(0);
    expect(video.currentTime).toBe(2); // unchanged phrase start
  });

  it("P is a no-op in phrase mode", () => {
    const player = startPlayer();

    player.playToCurrentWord();

    expect(video.play).toHaveBeenCalledTimes(1); // only the initial play
    expect(video.currentTime).toBe(1); // unchanged phrase start
  });

  it("toggleMode back to phrase mode loops the whole phrase", () => {
    const player = new PhrasePlayer(
      video as unknown as HTMLVideoElement,
      phrases,
      1
    );
    player.start();
    player.toggleMode(); // word mode, word 0
    player.nextWord();

    player.toggleMode();

    expect(player.currentMode).toBe("phrase");
    expect(video.currentTime).toBe(2); // phrase start
    // The loop end is now the phrase end (3000), not the word end (2500).
    flushFrame();
    video.currentTime = 2.55; // past the first word's end, inside the phrase
    flushFrame();
    expect(video.paused).toBe(false);
  });
});
