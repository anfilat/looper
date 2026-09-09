import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PhrasePlayer } from "./player";
import type { Phrase } from "./types";

const LOOP_GAP_MS = 200;

const phrases: Phrase[] = [
  { startTimeMs: 1000, endTimeMs: 2000, text: "hello" },
  { startTimeMs: 2000, endTimeMs: 3000, text: "world" },
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
});
