import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { PhrasePlayer } from "../player";
import type { Phrase } from "../types";

/** Imperative controls over the phrase loop. Stable across renders. */
export interface PhrasePlayerControls {
  nextPhrase(): void;
  prevPhrase(): void;
  goToStart(): void;
  increaseSpeed(): void;
  decreaseSpeed(): void;
  togglePause(): void;
}

export interface UsePhrasePlayerResult {
  /** Index of the current phrase; kept in sync with the player. */
  phraseIndex: number;
  /** Current playback speed, e.g. 1 → "1x". */
  speed: number;
  controls: PhrasePlayerControls;
}

/**
 * React binding for the PhrasePlayer class. Creates the player once the
 * video element is mounted, starts looping once the video has data,
 * and destroys it on unmount. Callbacks are kept in refs so the player
 * is never re-created when the parent re-renders with new closures.
 */
export function usePhrasePlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  phrases: Phrase[],
  startIndex: number,
  onPhraseChange: (index: number) => void,
  onVideoError: () => void
): UsePhrasePlayerResult {
  const playerRef = useRef<PhrasePlayer | null>(null);
  const [phraseIndex, setPhraseIndex] = useState(startIndex);
  const [speed, setSpeed] = useState(1);

  const onPhraseChangeRef = useRef(onPhraseChange);
  const onVideoErrorRef = useRef(onVideoError);
  useEffect(() => {
    onPhraseChangeRef.current = onPhraseChange;
    onVideoErrorRef.current = onVideoError;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const player = new PhrasePlayer(video, phrases, startIndex, (index) => {
      setPhraseIndex(index);
      onPhraseChangeRef.current(index);
    });
    playerRef.current = player;
    setSpeed(player.speed);

    const start = () => player.start();
    // The video may already have loaded by the time this effect runs.
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      start();
    } else {
      video.addEventListener("loadeddata", start, { once: true });
    }

    const onError = () => onVideoErrorRef.current();
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("loadeddata", start);
      video.removeEventListener("error", onError);
      player.destroy();
      playerRef.current = null;
    };
    // The player is bound to this video/phrases/startIndex for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const controls = useMemo<PhrasePlayerControls>(
    () => ({
      nextPhrase: () => playerRef.current?.nextPhrase(),
      prevPhrase: () => playerRef.current?.prevPhrase(),
      goToStart: () => playerRef.current?.goToStart(),
      togglePause: () => playerRef.current?.togglePause(),
      increaseSpeed: () => {
        playerRef.current?.increaseSpeed();
        if (playerRef.current) setSpeed(playerRef.current.speed);
      },
      decreaseSpeed: () => {
        playerRef.current?.decreaseSpeed();
        if (playerRef.current) setSpeed(playerRef.current.speed);
      },
    }),
    []
  );

  return { phraseIndex, speed, controls };
}
